const API_BASE = 'https://hamburger-api.powernplant101-c6b.workers.dev';
const ITEMS_PER_PAGE = 30;
const CATEGORY_SHORTCUTS = {
    'a': 'animations',
    'f': 'fonts',
    'i': 'images',
    'm': 'music',
    'c': 'mcicons',
    'p': 'presets',
    's': 'sfx',
    'b': 'mcsounds'
};
let allAssets = [];
let filteredAssets = [];
let displayedCount = 0;
let currentCategory = 'animations';
let currentSearchQuery = '';
let isLoading = false;
let isInitialLoad = true;
let focusedIndex = -1;
let favorites = new Set();
let recentHistory = [];
let isBatchMode = false;
let selectedAssets = new Set();
let searchTimeout = null;
let loadedFonts = new Map();
const FAVORITES_KEY = 'renderdragon_favorites';
const RECENT_KEY = 'renderdragon_recent';
const MAX_RECENT = 50;
const SETTINGS_KEY = 'renderdragon_settings';
const DEFAULT_SETTINGS = {
    showPreviewBtn: true,
    showCopyBtn: true,
    showDownloadBtn: true,
    defaultCategory: 'animations',
    gridColumns: 0,
    watchFolder: '',
    alwaysOnTop: true,
    pinned: false,
    autoplayPreviews: false
};
let settings = { ...DEFAULT_SETTINGS };
let isRecordingKeybind = false;
let pendingShortcut = null;
let currentShortcutInfo = null;
let mcsoundsSelectedPath = null;
let mcsoundsExpandedNodes = new Set(['ambient', 'block', 'entity', 'event', 'item', 'mob', 'music', 'random', 'record', 'ui', 'weather']);
let mcsoundsTreeData = null;
const searchInput = document.getElementById('searchInput');
const closeBtn = document.getElementById('closeBtn');
const assetsGrid = document.getElementById('assetsGrid');
const assetsContainer = document.getElementById('assetsContainer');
const loadingIndicator = document.getElementById('loadingIndicator');
const resultsCount = document.getElementById('resultsCount');
const filterBtns = document.querySelectorAll('.filter-btn');
const previewModal = document.getElementById('previewModal');
const previewContent = document.getElementById('previewContent');
const previewClose = document.getElementById('previewClose');
const goTopBtn = document.getElementById('goTopBtn');
const toastContainer = document.getElementById('toastContainer');
const selectBtn = document.getElementById('selectBtn');
const batchBar = document.getElementById('batchBar');
const selectedCountEl = document.getElementById('selectedCount');
const batchCancelBtn = document.getElementById('batchCancelBtn');
const batchDownloadBtn = document.getElementById('batchDownloadBtn');
const mainContainer = document.getElementById('mainContainer');
const mcsoundsSidebar = document.getElementById('mcsoundsSidebar');
const sidebarCollapseBtn = document.getElementById('sidebarCollapseBtn');
const mcsoundsTree = document.getElementById('mcsoundsTree');
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const settingsCloseBtn = document.getElementById('settingsCloseBtn');
const settingsSaveBtn = document.getElementById('settingsSaveBtn');
const showPreviewBtnCheck = document.getElementById('showPreviewBtn');
const showCopyBtnCheck = document.getElementById('showCopyBtn');
const showDownloadBtnCheck = document.getElementById('showDownloadBtn');
const alwaysOnTopCheck = document.getElementById('alwaysOnTop');
const pinnedCheck = document.getElementById('pinned');
const autoplayPreviewsCheck = document.getElementById('autoplayPreviews');
const defaultCategorySelect = document.getElementById('defaultCategory');
const gridColumnsSlider = document.getElementById('gridColumns');
const gridColumnsValue = document.getElementById('gridColumnsValue');
const keybindInput = document.getElementById('keybindInput');
const keybindRecordBtn = document.getElementById('keybindRecordBtn');
const keybindResetBtn = document.getElementById('keybindResetBtn');
const keybindHint = document.getElementById('keybindHint');
const keybindInputWrapper = keybindInput?.parentElement;
const updateModal = document.getElementById('updateModal');
const updateVersion = document.getElementById('updateVersion');
const updateNotes = document.getElementById('updateNotes');
const updateProgress = document.getElementById('updateProgress');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');
const updateLaterBtn = document.getElementById('updateLaterBtn');
const updateDownloadBtn = document.getElementById('updateDownloadBtn');
const updateInstallBtn = document.getElementById('updateInstallBtn');
const checkUpdateBtn = document.getElementById('checkUpdateBtn');
const appVersionEl = document.getElementById('appVersion');
let currentUpdateInfo = null;
document.addEventListener('DOMContentLoaded', async () => {
    loadSettings();
    applySettings();
    await loadKeybindSettings();
    await loadAppVersion();
    renderSkeletons();
    loadFavorites();
    loadRecentHistory();
    fetchAllAssets();
    setupEventListeners();
    setupUpdateListener();
    updateSearchPlaceholder();
});
function updateSearchPlaceholder() {
    if (searchInput) {
        searchInput.placeholder = "Search assets... (e.g. !M for music, !S for sfx, !F for fonts)";
    }
}
async function fetchAllAssets() {
    try {
        if (resultsCount) resultsCount.textContent = 'Loading assets...';
        const response = await fetch(`${API_BASE}/all`);
        const data = await response.json();
        allAssets = [];
        for (const [category, files] of Object.entries(data.categories)) {
            if (category === 'resources') continue;
            files.forEach(file => {
                allAssets.push({
                    ...file,
                    category: category
                });
            });
        }
        allAssets.sort((a, b) => a.title.localeCompare(b.title));
        try {
            const mcsoundsAssets = allAssets.filter(a => a.category === 'mcsounds');
            mcsoundsTreeData = buildMcsoundsTree(mcsoundsAssets);
            renderMcsoundsTree();
        } catch (treeError) {
            console.error('Failed to build mcsounds tree:', treeError);
        }
        isInitialLoad = false;
        filterAssets();
    } catch (error) {
        console.error('Failed to fetch assets:', error);
        if (resultsCount) {
            resultsCount.textContent = 'Failed to load assets. Check your connection.';
        }
    }
}
function filterAssets() {
    const rawQuery = searchInput.value.trim();
    let category = currentCategory;
    let searchQuery = rawQuery;
    const shortcutMatch = rawQuery.match(/^!([a-z])\s*/i);
    if (shortcutMatch) {
        const shortcut = shortcutMatch[1].toLowerCase();
        if (CATEGORY_SHORTCUTS[shortcut]) {
            category = CATEGORY_SHORTCUTS[shortcut];
            searchQuery = rawQuery.slice(shortcutMatch[0].length);
            filterBtns.forEach(btn => {
                btn.classList.toggle('active', btn.dataset.category === category);
            });
        }
    }
    const query = searchQuery.toLowerCase();
    currentSearchQuery = query;
    filteredAssets = allAssets.filter(asset => {
        if (category === 'favorites') {
            if (!favorites.has(asset.id)) return false;
        } else if (category === 'recent') {
            if (!recentHistory.includes(asset.id)) return false;
        } else if (category !== 'all' && asset.category !== category) {
            return false;
        }
        if (category === 'mcsounds' && mcsoundsSelectedPath) {
            if (!asset.subcategory || !asset.subcategory.startsWith(mcsoundsSelectedPath)) {
                return false;
            }
        }
        if (query) {
            return asset.title.toLowerCase().includes(query) ||
                asset.filename.toLowerCase().includes(query);
        }
        return true;
    });
    if (category === 'recent') {
        filteredAssets.sort((a, b) => {
            return recentHistory.indexOf(a.id) - recentHistory.indexOf(b.id);
        });
    }
    displayedCount = 0;
    focusedIndex = -1;
    assetsGrid.innerHTML = '';
    loadMoreAssets();
    updateResultsCount();
}
function loadFavorites() {
    const saved = localStorage.getItem(FAVORITES_KEY);
    if (saved) {
        try {
            favorites = new Set(JSON.parse(saved));
        } catch (e) {
            console.error('Failed to load favorites:', e);
            favorites = new Set();
        }
    }
}
function saveFavorites() {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
}
function loadRecentHistory() {
    const saved = localStorage.getItem(RECENT_KEY);
    if (saved) {
        try {
            recentHistory = JSON.parse(saved);
        } catch (e) {
            console.error('Failed to load recent history:', e);
            recentHistory = [];
        }
    }
}
function saveRecentHistory() {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentHistory));
}
function addToRecent(asset) {
    recentHistory = recentHistory.filter(id => id !== asset.id);
    recentHistory.unshift(asset.id);
    if (recentHistory.length > MAX_RECENT) {
        recentHistory = recentHistory.slice(0, MAX_RECENT);
    }
    saveRecentHistory();
}
function toggleFavorite(e, asset) {
    if (e) e.stopPropagation();
    const id = asset.id;
    const isFav = favorites.has(id);
    if (isFav) {
        favorites.delete(id);
        showToast(`Removed from favorites`, 'info');
    } else {
        favorites.add(id);
        showToast(`Added to favorites`, 'success');
    }
    saveFavorites();
    const tile = document.querySelector(`.asset-tile[data-id="${id}"]`);
    if (tile) {
        const favBtn = tile.querySelector('.favorite-btn');
        if (favBtn) favBtn.classList.toggle('active', !isFav);
    }
    if (currentCategory === 'favorites') {
        filterAssets();
    }
}
function updateResultsCount() {
    let categoryText = currentCategory === 'all' ? 'all categories' : currentCategory;
    if (currentCategory === 'mcsounds' && mcsoundsSelectedPath) {
        categoryText = `mcsounds / ${mcsoundsSelectedPath.replace(/\//g, ' / ')}`;
    }
    resultsCount.textContent = `${filteredAssets.length} assets in ${categoryText}`;
}
function loadMoreAssets() {
    if (isLoading || displayedCount >= filteredAssets.length) {
        loadingIndicator.classList.remove('visible');
        return;
    }
    isLoading = true;
    loadingIndicator.classList.add('visible');
    const endIndex = Math.min(displayedCount + ITEMS_PER_PAGE, filteredAssets.length);
    const fragment = document.createDocumentFragment();
    for (let i = displayedCount; i < endIndex; i++) {
        const asset = filteredAssets[i];
        const tile = createAssetTile(asset);
        fragment.appendChild(tile);
    }
    assetsGrid.appendChild(fragment);
    displayedCount = endIndex;
    isLoading = false;
    if (displayedCount >= filteredAssets.length) {
        loadingIndicator.classList.remove('visible');
    }
    if (filteredAssets.length === 0) {
        assetsGrid.innerHTML = `
      <div class="empty-state">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.3-4.3"></path>
          <path d="M8 8h6"></path>
        </svg>
        <p>No assets found</p>
      </div>
    `;
    }
}
function renderSkeletons() {
    assetsGrid.innerHTML = '';
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 12; i++) {
        const tile = document.createElement('div');
        tile.className = 'asset-tile skeleton';
        tile.innerHTML = `
            <div class="asset-preview"></div>
            <div class="asset-info">
                <div class="asset-title"></div>
                <div class="asset-meta"></div>
            </div>
        `;
        fragment.appendChild(tile);
    }
    assetsGrid.appendChild(fragment);
}
function createAssetTile(asset) {
    const tile = document.createElement('div');
    tile.className = 'asset-tile';
    tile.dataset.id = asset.id;
    tile.draggable = true;
    const previewHtml = getPreviewHtml(asset);
    const sizeText = formatSize(asset.size);
    const isFavorite = favorites.has(asset.id);
    const isSelected = selectedAssets.has(asset.id);
    const highlightedTitle = highlightText(asset.title, currentSearchQuery);
    let buttonsHtml = '';
    buttonsHtml += `
      <button class="action-btn favorite-btn ${isFavorite ? 'active' : ''}" title="Favorite">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
        </svg>
      </button>`;
    if (settings.showPreviewBtn) {
        buttonsHtml += `
      <button class="action-btn preview-btn" title="Preview">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      </button>`;
    }
    if (settings.showCopyBtn) {
        buttonsHtml += `
      <button class="action-btn copy-btn" title="Copy to Clipboard">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect>
          <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>
        </svg>
      </button>`;
    }
    if (settings.showDownloadBtn) {
        buttonsHtml += `
      <button class="action-btn download-btn" title="Download">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" x2="12" y1="15" y2="3"></line>
        </svg>
      </button>`;
    }
    const hasButtons = buttonsHtml.length > 0;
    const actionsHtml = hasButtons ? `<div class="asset-actions">${buttonsHtml}</div>` : '';
    tile.innerHTML = `
    <div class="asset-checkbox">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
    </div>
    <div class="asset-preview">
      ${previewHtml}
    </div>
    <div class="asset-info">
      <div class="asset-title" title="${escapeHtml(asset.title)}">${highlightedTitle}</div>
      <div class="asset-meta">
        <span class="asset-category ${asset.category}">${asset.category}</span>
        <span class="asset-size">${sizeText}</span>
      </div>
    </div>
    ${actionsHtml}
  `;
    if (isSelected) tile.classList.add('selected');
    if (settings.showPreviewBtn) {
        const previewBtn = tile.querySelector('.preview-btn');
        if (previewBtn) {
            previewBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                showPreview(asset);
            });
        }
    }
    if (settings.showCopyBtn) {
        const copyBtn = tile.querySelector('.copy-btn');
        if (copyBtn) {
            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                copyAsset(asset);
            });
        }
    }
    if (settings.showDownloadBtn) {
        const downloadBtn = tile.querySelector('.download-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                downloadAsset(asset);
            });
        }
    }
    const favoriteBtn = tile.querySelector('.favorite-btn');
    if (favoriteBtn) {
        favoriteBtn.addEventListener('click', (e) => toggleFavorite(e, asset));
    }
    tile.addEventListener('click', () => {
        if (isBatchMode) {
            toggleAssetSelection(asset);
        } else {
            showPreview(asset);
        }
    });
    tile.addEventListener('dragstart', (e) => {
        if (isBatchMode) {
            e.preventDefault();
            return;
        }
        tile.classList.add('dragging');
        e.preventDefault();
        window.api.startDrag(asset.url, asset.filename);
    });
    tile.addEventListener('dragend', () => {
        tile.classList.remove('dragging');
    });
    return tile;
}
function toggleAssetSelection(asset) {
    const id = asset.id;
    const tile = document.querySelector(`.asset-tile[data-id="${id}"]`);
    if (selectedAssets.has(id)) {
        selectedAssets.delete(id);
        if (tile) tile.classList.remove('selected');
    } else {
        selectedAssets.add(id);
        if (tile) tile.classList.add('selected');
    }
    updateBatchStatus();
}
function updateBatchStatus() {
    const count = selectedAssets.size;
    selectedCountEl.textContent = count;
    if (count > 0) {
        batchBar.classList.add('active');
    } else if (!isBatchMode) {
        batchBar.classList.remove('active');
    }
}
function toggleBatchMode() {
    isBatchMode = !isBatchMode;
    document.body.classList.toggle('batch-mode', isBatchMode);
    selectBtn.classList.toggle('active', isBatchMode);
    if (!isBatchMode) {
        selectedAssets.clear();
        document.querySelectorAll('.asset-tile.selected').forEach(t => { t.classList.remove('selected'); });
        batchBar.classList.remove('active');
    } else {
        updateBatchStatus();
    }
}
async function handleBatchDownload() {
    const assetsToDownload = allAssets.filter(a => selectedAssets.has(a.id));
    if (assetsToDownload.length === 0) return;
    showToast(`Preparing ZIP with ${assetsToDownload.length} assets...`, 'info');
    try {
        const zip = new JSZip();
        let completed = 0;
        for (const asset of assetsToDownload) {
            try {
                const response = await fetch(asset.url);
                const blob = await response.blob();
                const filename = asset.filename || `${asset.title}.${asset.ext}`;
                zip.file(filename, blob);
                completed++;
            } catch (err) {
                console.error(`Failed to fetch ${asset.title}:`, err);
            }
        }
        if (completed === 0) {
            showToast('Failed to download any assets', 'error');
            return;
        }
        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `renderdragon_assets_${new Date().toISOString().slice(0, 10)}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        showToast(`Downloaded ZIP with ${completed} assets`, 'success');
        toggleBatchMode();
    } catch (error) {
        console.error('Batch download error:', error);
        showToast('Failed to create ZIP file', 'error');
    }
}
function getPreviewHtml(asset) {
    const ext = asset.ext.toLowerCase();
    const uniqueId = `asset-${asset.id}`;
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
        return `<img src="${asset.url}" alt="${escapeHtml(asset.title)}" loading="lazy">`;
    }
    if (['mp4', 'webm', 'mov'].includes(ext)) {
        const autoplayAttr = settings.autoplayPreviews ? 'autoplay' : '';
        return `
      <video 
        class="video-preview" 
        src="${asset.url}" 
        muted 
        loop 
        ${autoplayAttr}
        preload="metadata"
        onmouseenter="this.play()" 
        ${settings.autoplayPreviews ? '' : 'onmouseleave="this.pause(); this.currentTime = 0;"'}
      ></video>
      <div class="play-overlay">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
          <polygon points="5 3 19 12 5 21 5 3"></polygon>
        </svg>
      </div>
    `;
    }
    if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) {
        return `
      <div class="audio-preview" data-src="${asset.url}" data-id="${uniqueId}">
        <button class="audio-play-btn" onclick="event.stopPropagation(); toggleAudioPreview('${uniqueId}', '${asset.url}')">
          <svg class="play-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          <svg class="pause-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="display:none;">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
        </button>
        <div class="audio-waveform">
          <div class="waveform-bar"></div>
          <div class="waveform-bar"></div>
          <div class="waveform-bar"></div>
          <div class="waveform-bar"></div>
          <div class="waveform-bar"></div>
          <div class="waveform-bar"></div>
          <div class="waveform-bar"></div>
          <div class="waveform-bar"></div>
        </div>
      </div>
      <audio id="${uniqueId}" preload="none"></audio>
    `;
    }
    if (['prpreset', 'prfpset'].includes(ext)) {
        if (asset.preview_url) {
            const autoplayAttr = settings.autoplayPreviews ? 'autoplay' : '';
            return `
        <video 
          class="video-preview" 
          src="${asset.preview_url}" 
          muted 
          loop 
          ${autoplayAttr}
          preload="metadata"
          onmouseenter="this.play()" 
          ${settings.autoplayPreviews ? '' : 'onmouseleave="this.pause(); this.currentTime = 0;"'}
        ></video>
        <div class="play-overlay">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" stroke="none">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
        </div>
      `;
        }
        if (asset.thumbnail) {
            return `<img src="${asset.thumbnail}" alt="${escapeHtml(asset.title)}" loading="lazy">`;
        }
        return `
      <div class="preset-preview">
        <div class="pr-icon">
          <span class="pr-text">Pr</span>
        </div>
      </div>
    `;
    }
    if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
        const fontFamily = `font-${asset.id}`;
        loadFont(fontFamily, asset.url);
        return `
      <div class="font-preview" data-font="${fontFamily}" data-asset-id="${asset.id}">
        <span class="font-sample" style="font-family: '${fontFamily}', sans-serif;">Aa</span>
        <span class="font-loading-indicator">
          <svg class="spinner" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
          </svg>
        </span>
      </div>
    `;
    }
    return `
    <svg class="preview-icon" xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path>
      <path d="M14 2v4a2 2 0 0 0 2 2h4"></path>
    </svg>
  `;
}
function loadFont(fontFamily, url) {
    if (loadedFonts.has(fontFamily)) {
        return loadedFonts.get(fontFamily);
    }
    const fontFace = new FontFace(fontFamily, `url(${url})`);
    const loadPromise = fontFace.load().then(loadedFont => {
        document.fonts.add(loadedFont);
        document.querySelectorAll(`[data-font="${fontFamily}"]`).forEach(el => {
            el.classList.add('font-loaded');
            const sample = el.querySelector('.font-sample');
            if (sample) {
                sample.style.fontFamily = `'${fontFamily}', sans-serif`;
            }
        });
        return loadedFont;
    }).catch(err => {
        console.warn(`Failed to load font: ${fontFamily}`, err);
        document.querySelectorAll(`[data-font="${fontFamily}"]`).forEach(el => {
            el.classList.add('font-error');
        });
    });
    loadedFonts.set(fontFamily, loadPromise);
    return loadPromise;
}
let currentPlayingAudio = null;
let currentPlayingId = null;
function toggleAudioPreview(id, url) {
    const audioEl = document.getElementById(id);
    const previewEl = document.querySelector(`[data-id="${id}"]`);
    if (!audioEl || !previewEl) return;
    if (currentPlayingAudio && currentPlayingId !== id) {
        stopAudioPreview(currentPlayingId);
    }
    if (audioEl.paused) {
        if (!audioEl.src) {
            audioEl.src = url;
        }
        audioEl.play();
        previewEl.classList.add('playing');
        previewEl.querySelector('.play-icon').style.display = 'none';
        previewEl.querySelector('.pause-icon').style.display = 'block';
        currentPlayingAudio = audioEl;
        currentPlayingId = id;
        audioEl.onended = () => stopAudioPreview(id);
    } else {
        stopAudioPreview(id);
    }
}
function stopAudioPreview(id) {
    const audioEl = document.getElementById(id);
    const previewEl = document.querySelector(`[data-id="${id}"]`);
    if (audioEl) {
        audioEl.pause();
        audioEl.currentTime = 0;
    }
    if (previewEl) {
        previewEl.classList.remove('playing');
        previewEl.querySelector('.play-icon').style.display = 'block';
        previewEl.querySelector('.pause-icon').style.display = 'none';
    }
    if (currentPlayingId === id) {
        currentPlayingAudio = null;
        currentPlayingId = null;
    }
}
function showPreview(asset) {
    if (asset) addToRecent(asset);
    const ext = asset.ext.toLowerCase();
    let content = '';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) {
        content = `<img src="${asset.url}" alt="${escapeHtml(asset.title)}">`;
    }
    else if (['mp4', 'webm', 'mov'].includes(ext)) {
        content = `<video src="${asset.url}" controls autoplay></video>`;
    }
    else if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) {
        const sizeText = formatSize(asset.size);
        content = `
            <div class="audio-preview-modal">
                <div class="audio-preview-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 18V5l12-2v13"></path>
                        <circle cx="6" cy="18" r="3"></circle>
                        <circle cx="18" cy="16" r="3"></circle>
                    </svg>
                </div>
                <div class="audio-preview-info">
                    <h3 class="audio-preview-title">${escapeHtml(asset.title)}</h3>
                    <p class="audio-preview-meta">${ext.toUpperCase()} • ${sizeText}</p>
                </div>
                <audio id="previewAudioPlayer" src="${asset.url}" controls autoplay></audio>
                <div class="audio-waveform-visual">
                    <div class="waveform-bar"></div>
                    <div class="waveform-bar"></div>
                    <div class="waveform-bar"></div>
                    <div class="waveform-bar"></div>
                    <div class="waveform-bar"></div>
                    <div class="waveform-bar"></div>
                    <div class="waveform-bar"></div>
                    <div class="waveform-bar"></div>
                    <div class="waveform-bar"></div>
                    <div class="waveform-bar"></div>
                    <div class="waveform-bar"></div>
                    <div class="waveform-bar"></div>
                </div>
            </div>
        `;
    }
    // Fonts - show full preview with sample text
    else if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
        const fontFamily = `font-${asset.id}`;
        loadFont(fontFamily, asset.url);
        content = `
            <div class="font-inspector">
                <div class="inspector-header">
                    <h3>${escapeHtml(asset.title)}</h3>
                    <p>${ext.toUpperCase()} • ${formatSize(asset.size)}</p>
                </div>
                <div class="inspector-controls">
                    <input type="text" id="fontPreviewInput" placeholder="Type something to test..." value="The quick brown fox jumps over the lazy dog">
                    <div class="font-size-control">
                        <span>Size: <span id="fontSizeValue">36px</span></span>
                        <input type="range" id="fontSizeSlider" min="12" max="120" value="36">
                    </div>
                </div>
                <div class="font-display-area" style="font-family: '${fontFamily}', sans-serif;">
                    <div id="fontPreviewText" class="font-preview-text">The quick brown fox jumps over the lazy dog</div>
                    <div class="font-alphabet">
                        <p>ABCDEFGHIJKLMNOPQRSTUVWXYZ</p>
                        <p>abcdefghijklmnopqrstuvwxyz</p>
                        <p>0123456789 !@#$%^&*()</p>
                    </div>
                </div>
            </div>
        `;
    }
    // Premiere Pro Presets
    else if (['prpreset', 'prfpset'].includes(ext)) {
        const sizeText = formatSize(asset.size);
        const previewUrl = asset.preview_url || '';

        content = `
            <div class="preset-inspector">
                <div class="inspector-header">
                    <div class="pr-icon-large">Pr</div>
                    <div class="inspector-info">
                        <h3>${escapeHtml(asset.title)}</h3>
                        <p>Premiere Pro Preset • ${ext.toUpperCase()} • ${sizeText}</p>
                    </div>
                </div>
                <div class="inspector-body">
                    ${previewUrl ? `
                        <div class="preset-video-container">
                            <video src="${previewUrl}" controls autoplay loop muted></video>
                        </div>
                    ` : `
                        <div class="preset-placeholder">
                            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
                                <polyline points="14 2 14 8 20 8"></polyline>
                            </svg>
                            <p>No video preview available</p>
                        </div>
                    `}
                    <div class="preset-actions-modal">
                        <button class="preview-download-btn big" data-asset-id="${asset.id}">
                            Download Preset
                        </button>
                    </div>
                </div>
            </div>
        `;
    }
    // Other files - just show info
    else {
        content = `
      <div style="text-align: center; color: #fff; padding: 40px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom: 20px; opacity: 0.5;">
          <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path>
          <path d="M14 2v4a2 2 0 0 0 2 2h4"></path>
        </svg>
        <p style="font-size: 18px; margin-bottom: 8px;">${escapeHtml(asset.title)}</p>
        <p style="color: #888; font-size: 14px;">Preview not available for this file type</p>
        <button class="preview-download-btn" data-asset-id="${asset.id}"
                style="margin-top: 20px; padding: 10px 24px; background: #22c55e; border: none; border-radius: 8px; color: #fff; cursor: pointer; font-size: 14px;">
          Download File
        </button>
      </div>
    `;
    }
    previewContent.innerHTML = content;
    const downloadBtn = previewContent.querySelector('.preview-download-btn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => downloadAsset(asset));
    }
    const waveformBars = previewContent.querySelectorAll('.audio-waveform-visual .waveform-bar');
    const fontInput = previewContent.querySelector('#fontPreviewInput');
    const fontPreviewText = previewContent.querySelector('#fontPreviewText');
    const fontSizeSlider = previewContent.querySelector('#fontSizeSlider');
    const fontSizeValue = previewContent.querySelector('#fontSizeValue');
    if (fontInput && fontPreviewText) {
        fontInput.addEventListener('input', () => {
            fontPreviewText.textContent = fontInput.value || ' ';
        });
        setTimeout(() => fontInput.focus(), 100);
    }
    if (fontSizeSlider && fontPreviewText && fontSizeValue) {
        fontSizeSlider.addEventListener('input', () => {
            const size = fontSizeSlider.value;
            fontPreviewText.style.fontSize = `${size}px`;
            fontSizeValue.textContent = `${size}px`;
        });
    }
    const audioPlayer = previewContent.querySelector('#previewAudioPlayer');
    if (audioPlayer && waveformBars.length > 0) {
        audioPlayer.addEventListener('play', () => {
            waveformBars.forEach(bar => bar.style.animationPlayState = 'running');
        });
        audioPlayer.addEventListener('pause', () => {
            waveformBars.forEach(bar => bar.style.animationPlayState = 'paused');
        });
        audioPlayer.addEventListener('ended', () => {
            waveformBars.forEach(bar => bar.style.animationPlayState = 'paused');
        });
        waveformBars.forEach(bar => bar.style.animationPlayState = 'running');
    }
    previewModal.classList.add('active');
}
function hidePreview() {
    previewModal.classList.remove('active');
    const media = previewContent.querySelector('video, audio');
    if (media) {
        media.pause();
        media.src = '';
    }
    previewContent.innerHTML = '';
}
async function downloadAsset(asset) {
    try {
        const result = await window.api.downloadAsset(asset.url, asset.filename);
        if (result.success) {
            console.log('Downloaded to:', result.path);
            showToast(`Downloaded: ${asset.title}`, 'success');
            if (settings.watchFolder) {
                console.log(`Copying to watch folder: ${settings.watchFolder}`);
            }
        } else {
            if (result.message !== 'Download canceled') {
                console.error('Download failed:', result.message);
                showToast(`Download failed: ${result.message}`, 'error');
            }
        }
    } catch (error) {
        console.error('Download error:', error);
        showToast('An error occurred during download', 'error');
    }
}
async function copyAsset(asset) {
    try {
        const btn = document.querySelector(`[data-id="${asset.id}"] .copy-btn`);
        if (btn) {
            btn.classList.add('loading');
        }
        const result = await window.api.copyToClipboard(asset.url, asset.filename, asset.ext);
        if (btn) {
            btn.classList.remove('loading');
            if (result.success) {
                btn.classList.add('success');
                setTimeout(() => btn.classList.remove('success'), 1500);
                showToast(`Copied ${asset.title} to clipboard`, 'success');
            } else {
                showToast(`Copy failed: ${result.message}`, 'error');
            }
        }
        if (result.success) {
            console.log('Copied to clipboard:', result.type);
        } else {
            console.error('Copy failed:', result.message);
        }
    } catch (error) {
        console.error('Copy error:', error);
        showToast('An error occurred while copying', 'error');
    }
}
function setupEventListeners() {
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            filterAssets();
        }, 200);
    });
    closeBtn.addEventListener('click', () => {
        window.api.hideWindow();
    });
    document.addEventListener('keydown', (e) => {
        if (isRecordingKeybind) {
            return;
        }
        if (e.key === 'Escape') {
            if (previewModal.classList.contains('active')) {
                hidePreview();
            } else if (settingsModal.classList.contains('active')) {
                closeSettings();
            } else {
                window.api.hideWindow();
            }
            return;
        }
        if (document.activeElement === searchInput) {
            if (e.key === 'ArrowDown' || e.key === 'Enter') {
                if (assetsGrid.children.length > 0) {
                    searchInput.blur();
                    focusedIndex = 0;
                    updateSelection();
                    e.preventDefault();
                }
            }
            return;
        }
        const tiles = assetsGrid.children;
        if (tiles.length === 0) return;
        if (previewModal.classList.contains('active')) return;
        const cols = getColumnsCount();
        switch (e.key) {
            case 'ArrowRight':
                focusedIndex = Math.min(focusedIndex + 1, tiles.length - 1);
                updateSelection();
                e.preventDefault();
                break;
            case 'ArrowLeft':
                focusedIndex = Math.max(focusedIndex - 1, 0);
                updateSelection();
                e.preventDefault();
                break;
            case 'ArrowDown':
                focusedIndex = Math.min(focusedIndex + cols, tiles.length - 1);
                updateSelection();
                e.preventDefault();
                break;
            case 'ArrowUp':
                focusedIndex = Math.max(focusedIndex - cols, 0);
                updateSelection();
                e.preventDefault();
                break;
            case 'Enter':
                if (focusedIndex >= 0 && tiles[focusedIndex]) {
                    const assetId = tiles[focusedIndex].dataset.id;
                    const asset = filteredAssets.find(a => String(a.id) === assetId);
                    if (asset) showPreview(asset);
                    e.preventDefault();
                }
                break;
            case 'c':
            case 'C':
                if (e.ctrlKey || e.metaKey) {
                    if (focusedIndex >= 0 && tiles[focusedIndex]) {
                        const assetId = tiles[focusedIndex].dataset.id;
                        const asset = filteredAssets.find(a => String(a.id) === assetId);
                        if (asset) copyAsset(asset);
                        e.preventDefault();
                    }
                }
                break;
            case 's':
            case 'S':
            case 'd':
            case 'D':
                if (e.ctrlKey || e.metaKey) {
                    if (focusedIndex >= 0 && tiles[focusedIndex]) {
                        const assetId = tiles[focusedIndex].dataset.id;
                        const asset = filteredAssets.find(a => String(a.id) === assetId);
                        if (asset) downloadAsset(asset);
                        e.preventDefault();
                    }
                }
                break;
        }
    });
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentCategory = btn.dataset.category;
            const rawQuery = searchInput.value.trim();
            const shortcutMatch = rawQuery.match(/^!([a-z])\s*/i);
            if (shortcutMatch) {
                searchInput.value = rawQuery.slice(shortcutMatch[0].length);
            }
            if (currentCategory === 'mcsounds') {
                showMcsoundsSidebar();
            } else {
                hideMcsoundsSidebar();
            }
            filterAssets();
        });
    });
    if (sidebarCollapseBtn) {
        sidebarCollapseBtn.addEventListener('click', toggleSidebarCollapse);
    }
    assetsContainer.addEventListener('scroll', () => {
        const { scrollTop, scrollHeight, clientHeight } = assetsContainer;
        if (scrollTop + clientHeight >= scrollHeight - 100) {
            loadMoreAssets();
        }
        if (scrollTop > 200) {
            goTopBtn.classList.add('visible');
        } else {
            goTopBtn.classList.remove('visible');
        }
    });
    goTopBtn.addEventListener('click', () => {
        assetsContainer.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
    previewClose.addEventListener('click', hidePreview);
    previewModal.addEventListener('click', (e) => {
        if (e.target === previewModal) {
            hidePreview();
        }
    });
    if (selectBtn) selectBtn.addEventListener('click', toggleBatchMode);
    if (batchCancelBtn) batchCancelBtn.addEventListener('click', toggleBatchMode);
    if (batchDownloadBtn) batchDownloadBtn.addEventListener('click', handleBatchDownload);
    window.api.onWindowShown(() => {
        searchInput.focus();
        searchInput.select();
    });
    window.api.onWindowHidden(() => {
        hidePreview();
    });
    settingsBtn.addEventListener('click', openSettings);
    settingsCloseBtn.addEventListener('click', closeSettings);
    settingsSaveBtn.addEventListener('click', handleSaveSettings);
    settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) {
            closeSettings();
        }
    });
    gridColumnsSlider.addEventListener('input', updateGridColumnsLabel);
    if (keybindInput) {
        keybindInput.addEventListener('click', startKeybindRecording);
    }
    if (keybindRecordBtn) {
        keybindRecordBtn.addEventListener('click', startKeybindRecording);
    }
    if (keybindResetBtn) {
        keybindResetBtn.addEventListener('click', resetKeybind);
    }
    const exportBtn = document.getElementById('exportBtn');
    const importBtn = document.getElementById('importBtn');
    const importFile = document.getElementById('importFile');
    if (exportBtn) exportBtn.addEventListener('click', exportData);
    if (importBtn) importBtn.addEventListener('click', () => importFile.click());
    if (importFile) importFile.addEventListener('change', importData);
    if (checkUpdateBtn) {
        checkUpdateBtn.addEventListener('click', () => {
            window.api.checkForUpdates();
        });
    }
    if (updateLaterBtn) {
        updateLaterBtn.addEventListener('click', hideUpdateModal);
    }
    if (updateDownloadBtn) {
        updateDownloadBtn.addEventListener('click', () => {
            window.api.downloadUpdate();
        });
    }
    if (updateInstallBtn) {
        updateInstallBtn.addEventListener('click', () => {
            window.api.quitAndInstall();
        });
    }
    if (updateModal) {
        updateModal.addEventListener('click', (e) => {
            if (e.target === updateModal) {
                hideUpdateModal();
            }
        });
    }
}
function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
function highlightText(text, query) {
    if (!query) return escapeHtml(text);
    const escapedText = escapeHtml(text);
    const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    return escapedText.replace(regex, '<span class="highlight">$1</span>');
}
function showToast(message, type = 'info') {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = '';
    if (type === 'success') {
        icon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
    } else if (type === 'error') {
        icon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    } else {
        icon = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    }
    toast.innerHTML = `${icon}<span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
function updateSelection() {
    const tiles = assetsGrid.children;
    for (let i = 0; i < tiles.length; i++) {
        const tile = tiles[i];
        if (i === focusedIndex) {
            tile.classList.add('focused');
            tile.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            tile.classList.remove('focused');
        }
    }
}
function getColumnsCount() {
    const tiles = assetsGrid.children;
    if (tiles.length < 2) return 1;
    const firstTop = tiles[0].offsetTop;
    let cols = 0;
    for (let i = 0; i < tiles.length; i++) {
        if (tiles[i].offsetTop > firstTop) break;
        cols++;
    }
    return cols || 1;
}
function loadSettings() {
    try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) {
            settings = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
        }
    } catch (e) {
        console.warn('Failed to load settings:', e);
        settings = { ...DEFAULT_SETTINGS };
    }
}
function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
        console.warn('Failed to save settings:', e);
    }
}
function applyGridColumns() {
    if (settings.gridColumns === 0) {
        assetsGrid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(180px, 1fr))';
    } else {
        assetsGrid.style.gridTemplateColumns = `repeat(${settings.gridColumns}, 1fr)`;
    }
}
function applySettings() {
    currentCategory = settings.defaultCategory;
    filterBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === currentCategory);
    });
    applyGridColumns();
    const watchFolderInput = document.getElementById('watchFolderInput');
    if (watchFolderInput) watchFolderInput.value = settings.watchFolder || '';
    if (window.api && window.api.setAlwaysOnTop) {
        console.log(`app.js: Calling setAlwaysOnTop(${settings.alwaysOnTop})`);
        window.api.setAlwaysOnTop(settings.alwaysOnTop);
    }
    if (window.api && window.api.setPinned) {
        console.log(`app.js: Calling setPinned(${settings.pinned})`);
        window.api.setPinned(settings.pinned);
    }
}
function exportData() {
    const data = {
        settings: settings,
        favorites: [...favorites],
        recentHistory: recentHistory
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `renderdragon_data_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    showToast('Data exported successfully', 'success');
}
function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const data = JSON.parse(event.target.result);
            if (data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
                settings = { ...DEFAULT_SETTINGS, ...data.settings };
            }
            if (Array.isArray(data.favorites)) {
                favorites = new Set(data.favorites);
            }
            if (Array.isArray(data.recentHistory)) {
                recentHistory = data.recentHistory;
            }
            saveSettings();
            saveFavorites();
            saveRecentHistory();
            applySettings();
            showToast('Data imported successfully. Reloading...', 'success');
            setTimeout(() => window.location.reload(), 1500);
        } catch (error) {
            showToast('Failed to import data: Invalid file format', 'error');
        }
    };
    reader.readAsText(file);
}
function openSettings() {
    showPreviewBtnCheck.checked = settings.showPreviewBtn;
    showCopyBtnCheck.checked = settings.showCopyBtn;
    showDownloadBtnCheck.checked = settings.showDownloadBtn;
    alwaysOnTopCheck.checked = settings.alwaysOnTop;
    pinnedCheck.checked = settings.pinned;
    autoplayPreviewsCheck.checked = settings.autoplayPreviews;
    defaultCategorySelect.value = settings.defaultCategory;
    gridColumnsSlider.value = settings.gridColumns;
    updateGridColumnsLabel();
    settingsModal.classList.add('active');
}
function closeSettings() {
    settingsModal.classList.remove('active');
}
function updateGridColumnsLabel() {
    const value = parseInt(gridColumnsSlider.value);
    gridColumnsValue.textContent = value === 0 ? 'Auto' : value;
}
async function handleSaveSettings() {
    const watchFolderInput = document.getElementById('watchFolderInput');
    const newSettings = {
        showPreviewBtn: showPreviewBtnCheck.checked,
        showCopyBtn: showCopyBtnCheck.checked,
        showDownloadBtn: showDownloadBtnCheck.checked,
        alwaysOnTop: alwaysOnTopCheck.checked,
        pinned: pinnedCheck.checked,
        autoplayPreviews: autoplayPreviewsCheck.checked,
        defaultCategory: defaultCategorySelect.value,
        gridColumns: parseInt(gridColumnsSlider.value),
        watchFolder: watchFolderInput ? watchFolderInput.value : ''
    };
    const buttonsChanged =
        settings.showPreviewBtn !== newSettings.showPreviewBtn ||
        settings.showCopyBtn !== newSettings.showCopyBtn ||
        settings.showDownloadBtn !== newSettings.showDownloadBtn;
    const categoryChanged = settings.defaultCategory !== newSettings.defaultCategory;
    settings = newSettings;
    saveSettings();
    await applyKeybindChange();
    applySettings();
    if (categoryChanged || buttonsChanged) {
        filterAssets();
    }
    closeSettings();
}

async function loadKeybindSettings() {
    try {
        const info = await window.api.getShortcut();
        currentShortcutInfo = info;
        if (keybindInput) {
            keybindInput.value = formatShortcutForDisplay(info.shortcut);
        }
        updateKeybindHint();
    } catch (e) {
        console.error('Failed to load keybind settings:', e);
    }
}
function formatShortcutForDisplay(shortcut) {
    if (!shortcut) return '';
    return shortcut
        .replace(/CommandOrControl/gi, window.api.platform === 'darwin' ? '⌘' : 'Ctrl')
        .replace(/Control/gi, window.api.platform === 'darwin' ? '⌃' : 'Ctrl')
        .replace(/Command/gi, '⌘')
        .replace(/Alt/gi, window.api.platform === 'darwin' ? '⌥' : 'Alt')
        .replace(/Shift/gi, window.api.platform === 'darwin' ? '⇧' : 'Shift')
        .replace(/\+/g, ' + ')
        .replace(/Space/gi, 'Space');
}
function formatKeyEventToAccelerator(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) {
        parts.push('CommandOrControl');
    }
    if (e.altKey) {
        parts.push('Alt');
    }
    if (e.shiftKey) {
        parts.push('Shift');
    }
    let key = e.key;
    const code = e.code;
    if (key === ' ' || key === '\u00A0' || code === 'Space') {
        key = 'Space';
    } else if (key === 'Escape' || code === 'Escape') key = 'Escape';
    else if (key === 'Tab' || code === 'Tab') key = 'Tab';
    else if (key === 'Enter' || code === 'Enter') key = 'Enter';
    else if (key === 'Backspace' || code === 'Backspace') key = 'Backspace';
    else if (key === 'Delete' || code === 'Delete') key = 'Delete';
    else if (key === 'ArrowUp' || code === 'ArrowUp') key = 'Up';
    else if (key === 'ArrowDown' || code === 'ArrowDown') key = 'Down';
    else if (key === 'ArrowLeft' || code === 'ArrowLeft') key = 'Left';
    else if (key === 'ArrowRight' || code === 'ArrowRight') key = 'Right';
    else if (key === 'Home' || code === 'Home') key = 'Home';
    else if (key === 'End' || code === 'End') key = 'End';
    else if (key === 'PageUp' || code === 'PageUp') key = 'PageUp';
    else if (key === 'PageDown' || code === 'PageDown') key = 'PageDown';
    else if (key === 'Insert' || code === 'Insert') key = 'Insert';
    else if (code && code.startsWith('F') && !isNaN(code.slice(1)) && parseInt(code.slice(1)) <= 12) {
        key = code;
    } else if (key.startsWith('F') && !isNaN(key.slice(1)) && parseInt(key.slice(1)) <= 12) {
        key = key;
    } else if (code && code.startsWith('Key')) {
        key = code.slice(3);
    } else if (code && code.startsWith('Digit')) {
        key = code.slice(5);
    } else if (key.length === 1 && key.charCodeAt(0) >= 32 && key.charCodeAt(0) <= 126) {
        key = key.toUpperCase();
    } else {
        console.log('Unknown key:', key, 'code:', code);
        return null;
    }
    if (['Control', 'Alt', 'Shift', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock'].includes(key)) {
        return null;
    }
    if (!/^[A-Za-z0-9]+$/.test(key) && !['Space', 'Escape', 'Tab', 'Enter', 'Backspace', 'Delete', 'Up', 'Down', 'Left', 'Right', 'Home', 'End', 'PageUp', 'PageDown', 'Insert', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'].includes(key)) {
        console.log('Invalid key for accelerator:', key);
        return null;
    }
    if (parts.length === 0) {
        return null;
    }
    parts.push(key);
    const accelerator = parts.join('+');
    if (!/^[\x20-\x7E]+$/.test(accelerator)) {
        console.log('Non-ASCII accelerator rejected:', accelerator);
        return null;
    }
    return accelerator;
}
function startKeybindRecording() {
    if (isRecordingKeybind) {
        stopKeybindRecording();
        return;
    }
    console.log('Starting keybind recording...');
    isRecordingKeybind = true;
    pendingShortcut = null;
    if (keybindInput) {
        keybindInput.value = 'Press keys...';
        keybindInput.classList.add('recording');
        keybindInput.focus();
    }
    if (keybindInputWrapper) {
        keybindInputWrapper.classList.add('recording');
    }
    if (keybindRecordBtn) {
        keybindRecordBtn.classList.add('recording');
    }
    if (keybindHint) {
        keybindHint.textContent = 'Press a key combination (e.g., Ctrl+Shift+Space), then click Save';
        keybindHint.className = 'keybind-hint';
    }
    window.addEventListener('keydown', handleKeybindRecording, true);
    window.addEventListener('keyup', handleKeybindKeyUp, true);
}
function stopKeybindRecording() {
    console.log('Stopping keybind recording...');
    isRecordingKeybind = false;
    if (keybindInput) {
        keybindInput.classList.remove('recording');
        if (!pendingShortcut && currentShortcutInfo) {
            keybindInput.value = formatShortcutForDisplay(currentShortcutInfo.shortcut);
        }
        keybindInput.blur();
    }
    if (keybindInputWrapper) {
        keybindInputWrapper.classList.remove('recording');
    }
    if (keybindRecordBtn) {
        keybindRecordBtn.classList.remove('recording');
    }
    window.removeEventListener('keydown', handleKeybindRecording, true);
    window.removeEventListener('keyup', handleKeybindKeyUp, true);
}
function handleKeybindKeyUp(e) {
    if (isRecordingKeybind) {
        e.preventDefault();
        e.stopPropagation();
    }
}
function handleKeybindRecording(e) {
    console.log('Key event captured:', e.key, 'ctrl:', e.ctrlKey, 'meta:', e.metaKey, 'alt:', e.altKey, 'shift:', e.shiftKey);
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') {
        stopKeybindRecording();
        if (keybindHint) {
            keybindHint.textContent = 'Recording cancelled';
            keybindHint.className = 'keybind-hint';
        }
        return;
    }
    const accelerator = formatKeyEventToAccelerator(e);
    console.log('Accelerator result:', accelerator);
    if (accelerator) {
        pendingShortcut = accelerator;
        if (keybindInput) {
            keybindInput.value = formatShortcutForDisplay(accelerator);
        }
        stopKeybindRecording();
        if (keybindHint) {
            keybindHint.textContent = 'New shortcut recorded! Click "Save Settings" to apply.';
            keybindHint.className = 'keybind-hint success';
        }
    } else {
        if (keybindHint) {
            keybindHint.textContent = 'Please include a modifier key (Cmd, Ctrl, Alt, or Shift) with your shortcut';
            keybindHint.className = 'keybind-hint';
        }
    }
}
async function applyKeybindChange() {
    if (!pendingShortcut) return true;
    try {
        const result = await window.api.setShortcut(pendingShortcut);
        if (result.success) {
            currentShortcutInfo.shortcut = pendingShortcut;
            pendingShortcut = null;
            if (keybindHint) {
                keybindHint.textContent = 'Shortcut updated successfully!';
                keybindHint.className = 'keybind-hint success';
            }
            return true;
        } else {
            if (keybindHint) {
                keybindHint.textContent = result.message || 'Failed to set shortcut. It may be in use.';
                keybindHint.className = 'keybind-hint error';
            }
            if (keybindInput && currentShortcutInfo) {
                keybindInput.value = formatShortcutForDisplay(currentShortcutInfo.shortcut);
            }
            return false;
        }
    } catch (e) {
        console.error('Failed to set shortcut:', e);
        if (keybindHint) {
            keybindHint.textContent = 'Error setting shortcut';
            keybindHint.className = 'keybind-hint error';
        }
        return false;
    }
}
async function resetKeybind() {
    try {
        const result = await window.api.resetShortcut();
        if (result.success) {
            await loadKeybindSettings();
            pendingShortcut = null;
            if (keybindHint) {
                keybindHint.textContent = 'Shortcut reset to default';
                keybindHint.className = 'keybind-hint success';
            }
        } else {
            if (keybindHint) {
                keybindHint.textContent = result.message || 'Failed to reset shortcut';
                keybindHint.className = 'keybind-hint error';
            }
        }
    } catch (e) {
        console.error('Failed to reset shortcut:', e);
    }
}
function updateKeybindHint() {
    if (!keybindHint || !currentShortcutInfo) return;
    const defaultDisplay = formatShortcutForDisplay(currentShortcutInfo.defaultShortcut);
    keybindHint.textContent = `Default: ${defaultDisplay}`;
    keybindHint.className = 'keybind-hint';
}
function buildMcsoundsTree(assets) {
    const tree = {};
    assets.forEach(asset => {
        if (!asset.subcategory) return;
        const parts = asset.subcategory.split('/');
        let current = tree;
        parts.forEach((part, index) => {
            if (!current[part]) {
                current[part] = {
                    __count: 0,
                    __children: {}
                };
            }
            current[part].__count++;
            current = current[part].__children;
        });
    });
    return tree;
}
function renderMcsoundsTree() {
    if (!mcsoundsTree || !mcsoundsTreeData || Object.keys(mcsoundsTreeData).length === 0) {
        if (mcsoundsTree) mcsoundsTree.innerHTML = '';
        return;
    }
    const sortedKeys = Object.keys(mcsoundsTreeData).sort((a, b) => {
        const countA = mcsoundsTreeData[a].__count;
        const countB = mcsoundsTreeData[b].__count;
        return countB - countA;
    });
    let html = `
        <div class="tree-all-btn ${mcsoundsSelectedPath === null ? 'selected' : ''}" data-path="">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect width="7" height="7" x="3" y="3" rx="1"></rect>
                <rect width="7" height="7" x="14" y="3" rx="1"></rect>
                <rect width="7" height="7" x="14" y="14" rx="1"></rect>
                <rect width="7" height="7" x="3" y="14" rx="1"></rect>
            </svg>
            <span class="tree-label">All Sounds</span>
        </div>
    `;
    sortedKeys.forEach(key => {
        html += renderTreeNode(key, mcsoundsTreeData[key], '', 0);
    });
    mcsoundsTree.innerHTML = html;
    attachTreeEventListeners();
}
function renderTreeNode(name, node, parentPath, depth) {
    const currentPath = parentPath ? `${parentPath}/${name}` : name;
    const hasChildren = Object.keys(node.__children).length > 0;
    const isExpanded = mcsoundsExpandedNodes.has(currentPath);
    const isSelected = mcsoundsSelectedPath === currentPath;
    const depthClass = depth === 0 ? '' : depth === 1 ? 'child' : 'grandchild';
    let html = `
        <div class="tree-node ${depthClass}">
            <div class="tree-node-header ${isSelected ? 'selected' : ''}" data-path="${currentPath}">
                <span class="tree-expand-icon ${isExpanded ? 'expanded' : ''} ${!hasChildren ? 'hidden' : ''}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="m9 18 6-6-6-6"/>
                    </svg>
                </span>
                <svg class="tree-folder-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
                </svg>
                <span class="tree-label">${formatTreeLabel(name)}</span>
                <span class="tree-count">${node.__count}</span>
            </div>
    `;
    if (hasChildren) {
        const sortedChildren = Object.keys(node.__children).sort((a, b) => {
            const countA = node.__children[a].__count;
            const countB = node.__children[b].__count;
            return countB - countA;
        });
        html += `<div class="tree-children ${isExpanded ? 'expanded' : ''}">`;
        sortedChildren.forEach(childKey => {
            html += renderTreeNode(childKey, node.__children[childKey], currentPath, depth + 1);
        });
        html += '</div>';
    }
    html += '</div>';
    return html;
}
function formatTreeLabel(name) {
    return name
        .split('_')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
function attachTreeEventListeners() {
    document.querySelectorAll('.tree-node-header').forEach(header => {
        header.addEventListener('click', (e) => {
            const path = header.dataset.path;
            const expandIcon = header.querySelector('.tree-expand-icon');
            const hasChildren = !expandIcon.classList.contains('hidden');
            if (hasChildren && e.target.closest('.tree-expand-icon')) {
                toggleTreeNode(path);
            } else {
                selectTreeNode(path);
            }
        });
    });
    document.querySelectorAll('.tree-all-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectTreeNode(null);
        });
    });
}
function toggleTreeNode(path) {
    if (mcsoundsExpandedNodes.has(path)) {
        mcsoundsExpandedNodes.delete(path);
    } else {
        mcsoundsExpandedNodes.add(path);
    }
    renderMcsoundsTree();
}
function selectTreeNode(path) {
    mcsoundsSelectedPath = path;
    filterAssets();
    renderMcsoundsTree();
}
function showMcsoundsSidebar() {
    if (mcsoundsSidebar) {
        mcsoundsSidebar.classList.add('visible');
    }
    if (mainContainer) {
        mainContainer.classList.add('with-sidebar');
    }
}
function hideMcsoundsSidebar() {
    if (mcsoundsSidebar) {
        mcsoundsSidebar.classList.remove('visible');
        mcsoundsSidebar.classList.remove('collapsed');
    }
    if (mainContainer) {
        mainContainer.classList.remove('with-sidebar');
    }
    mcsoundsSelectedPath = null;
}
function toggleSidebarCollapse() {
    if (mcsoundsSidebar) {
        mcsoundsSidebar.classList.toggle('collapsed');
    }
}
async function loadAppVersion() {
    try {
        const info = await window.api.getAppVersion();
        if (appVersionEl) {
            appVersionEl.textContent = info.version;
        }
    } catch (error) {
        console.error('Failed to get app version:', error);
    }
}
function setupUpdateListener() {
    if (window.api.onUpdateStatus) {
        window.api.onUpdateStatus((data) => {
            handleUpdateStatus(data);
        });
    }
}
function handleUpdateStatus(data) {
    switch (data.status) {
        case 'checking':
            if (checkUpdateBtn) {
                checkUpdateBtn.disabled = true;
                checkUpdateBtn.innerHTML = `
                    <svg class="spinner" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                    Checking...
                `;
            }
            break;
        case 'available':
            currentUpdateInfo = data;
            showUpdateModal(data);
            resetCheckUpdateBtn();
            break;
        case 'not-available':
            if (checkUpdateBtn) {
                checkUpdateBtn.innerHTML = `
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20 6 9 17l-5-5"/>
                    </svg>
                    Up to Date
                `;
                setTimeout(resetCheckUpdateBtn, 2000);
            }
            break;
        case 'downloading':
            if (updateProgress) {
                updateProgress.style.display = 'flex';
            }
            if (progressFill) {
                progressFill.style.width = `${data.percent}%`;
            }
            if (progressText) {
                progressText.textContent = `${data.percent}%`;
            }
            if (updateDownloadBtn) {
                updateDownloadBtn.disabled = true;
                updateDownloadBtn.textContent = 'Downloading...';
            }
            break;
        case 'downloaded':
            if (updateProgress) {
                updateProgress.style.display = 'none';
            }
            if (updateDownloadBtn) {
                updateDownloadBtn.style.display = 'none';
            }
            if (updateInstallBtn) {
                updateInstallBtn.style.display = 'inline-flex';
            }
            break;
        case 'error':
            console.error('Update error:', data.message);
            resetCheckUpdateBtn();
            hideUpdateModal();
            break;
    }
}
function showUpdateModal(data) {
    if (updateModal) {
        updateModal.classList.add('active');
    }
    if (updateVersion) {
        updateVersion.textContent = `v${data.version}`;
    }
    if (updateNotes && data.releaseNotes) {
        updateNotes.innerHTML = formatReleaseNotes(data.releaseNotes);
    }
    if (updateProgress) {
        updateProgress.style.display = 'none';
    }
    if (updateDownloadBtn) {
        updateDownloadBtn.style.display = 'inline-flex';
        updateDownloadBtn.disabled = false;
        updateDownloadBtn.textContent = 'Download';
    }
    if (updateInstallBtn) {
        updateInstallBtn.style.display = 'none';
    }
}
function hideUpdateModal() {
    if (updateModal) {
        updateModal.classList.remove('active');
    }
}
function resetCheckUpdateBtn() {
    if (checkUpdateBtn) {
        checkUpdateBtn.disabled = false;
        checkUpdateBtn.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
                <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/>
                <path d="M16 16h5v5"/>
            </svg>
            Check for Updates
        `;
    }
}
function formatReleaseNotes(notes) {
    if (typeof notes === 'string') {
        return `<p>${escapeHtml(notes)}</p>`;
    }
    if (notes && notes.note) {
        return `<p>${escapeHtml(notes.note)}</p>`;
    }
    return '';
}

