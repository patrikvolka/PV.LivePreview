/*
 * PV.LivePreview – integrovaný responzivní živý náhled v editaci obsahu.
 * Registrováno v ResourceManagementOptionsConfiguration jako script "PV.LivePreview".
 *
 * Skript nemá žádnou konfiguraci v kódu – vše čte z markeru, který vykreslí
 * shape LivePreviewInjection: <div data-pv-live-preview data-position=... >.
 */
(function () {
'use strict';

// Escapování textu vkládaného do HTML šablony (atributy title)
const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

// Uživatelské volby v localStorage. To může být nedostupné (anonymní okno, zakázaná
// data webu) nebo vyhodit výjimku – volba se pak prostě nezapamatuje.
const STORAGE_PREFIX = 'pv-live-preview-';
const storage = {
    get(key) {
        try { return localStorage.getItem(STORAGE_PREFIX + key); } catch (e) { return null; }
    },
    set(key, value) {
        try { localStorage.setItem(STORAGE_PREFIX + key, String(value)); } catch (e) {}
    },
    remove(key) {
        try { localStorage.removeItem(STORAGE_PREFIX + key); } catch (e) {}
    }
};

// Sandbox iframů náhledu (bod 9 code review) – částečná izolace:
//  - bez allow-forms: prohlížeč zablokuje odeslání formulářů (i programové form.submit()),
//  - bez allow-top-navigation: skript náhledu nepřesměruje administraci (top.location),
//  - bez allow-modals: alert/confirm/print z náhledu nezablokují editor.
// allow-same-origin zůstává: téma si hostuje vlastní fonty (CORS) a skript editoru
// potřebuje přístup do dokumentu náhledu (scroll, zvýraznění změn, odkazy, zkratky).
// Skripty náhledu tedy proti administraci izolované nejsou – vědomý kompromis.
// Stejná hodnota je i ve Views/LivePreview/Window.cshtml (samostatné okno).
const PREVIEW_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox';

// Web autora modulu (podpis v pravém dolním rohu panelu; stejná adresa je v Manifest.cs)
const AUTHOR_URL = 'https://patrik-volka.cz';

function initLivePreview(marker) {
    const position = marker.dataset.position;
    const renderEndpoint = marker.dataset.renderEndpoint;
    // Vykreslený náhled se do iframu načítá z URL frame/{token} (ne srcdoc – kvůli CSP)
    const frameEndpoint = marker.dataset.frameEndpoint;
    // Stránka samostatného okna náhledu
    const windowEndpoint = marker.dataset.windowEndpoint;
    const serverContentType = marker.dataset.contentType;
    // U nové položky (Create) je prázdné
    const serverContentItemId = marker.dataset.contentItemId;
    // Lokalizované texty; při chybě se použijí anglické výchozí hodnoty uvedené u jednotlivých použití
    let translations = {};
    try {
        translations = JSON.parse(marker.dataset.translations || '{}');
    } catch (e) {
        console.error('PV.LivePreview: Error parsing translations:', e);
    }
    // Nastavení typu obsahu (editor typu obsahu): zařízení, zpoždění, skrytí při otevření
    let settings = {};
    try {
        settings = JSON.parse(marker.dataset.settings || '{}') || {};
    } catch (e) {
        console.error('PV.LivePreview: Error parsing settings:', e);
    }

    // Vlastní zařízení typu obsahu – server je validuje, kontrola zde je jen pojistka
    const PRESET_PREFIX = 'preset:';
    const presets = (Array.isArray(settings.customDevices) ? settings.customDevices : [])
        .filter(d => d && typeof d.name === 'string' && d.name
            && Number.isInteger(d.width) && Number.isInteger(d.height))
        .map(d => ({ id: PRESET_PREFIX + d.name, name: d.name, width: d.width, height: d.height }));

    // Zpoždění aktualizace po změně formuláře (ms)
    const UPDATE_DELAY = Number.isInteger(settings.updateDelay)
        ? Math.min(Math.max(settings.updateDelay, 100), 5000)
        : 600;

    const form = marker.closest('form');
    if (!form) return;

    // Pojistka: nad jedním formulářem smí běžet jen jedna instance náhledu
    if (form.dataset.pvLivePreview) return;
    form.dataset.pvLivePreview = '1';

    // Lokalizovaný text s anglickou výchozí hodnotou, escapovaný pro vložení do HTML
    const t = (key, fallback) => escapeHtml(translations[key] || fallback);

    // Tlačítka vlastních zařízení: ikona podle kratší strany + zkrácený název
    const presetIcon = (d) => {
        const shorter = Math.min(d.width, d.height);
        return shorter < 600 ? 'fa-mobile-alt' : shorter < 1000 ? 'fa-tablet-alt' : 'fa-desktop';
    };
    const presetButtonsHtml = presets.map(d => `
                <button type="button" class="btn btn-sm btn-outline-secondary device-btn pv-lp-preset-btn" data-device="${escapeHtml(d.id)}" title="${escapeHtml(d.name)} (${d.width}x${d.height})"><i class="fas ${presetIcon(d)}"></i> <span class="pv-lp-device-label">${escapeHtml(d.name)}</span></button>`).join('');

    // Bez inline atributů style – při zapnutém CSP (style-src bez 'unsafe-inline') by je prohlížeč ignoroval
    const panelHtml = `
        <div class="pv-live-preview-panel">
            <div class="pv-live-preview-toolbar">
                <button type="button" class="btn btn-sm btn-outline-secondary device-btn" data-device="fluid" title="${t('fluidTitle', 'Fluid')}"><i class="fas fa-expand"></i></button>
                <button type="button" class="btn btn-sm btn-outline-secondary device-btn" data-device="mobile" title="${t('mobilePortraitTitle', 'Mobile')}"><i class="fas fa-mobile-alt"></i></button>
                <button type="button" class="btn btn-sm btn-outline-secondary device-btn" data-device="tablet" title="${t('tabletPortraitTitle', 'Tablet')}"><i class="fas fa-tablet-alt"></i></button>
                <button type="button" class="btn btn-sm btn-outline-secondary device-btn" data-device="laptop" title="${t('laptopTitle', 'Laptop')}"><i class="fas fa-laptop"></i></button>
                <button type="button" class="btn btn-sm btn-outline-secondary device-btn" data-device="desktop" title="${t('desktopTitle', 'Desktop')}"><i class="fas fa-desktop"></i></button>${presetButtonsHtml}
                <button type="button" class="btn btn-sm btn-outline-secondary device-btn" data-device="custom" title="${t('customTitle', 'Custom size')}"><i class="fas fa-ruler-combined"></i></button>
                <!-- Pole bez name a s form="" mimo formulář: neodešlou se, Enter neodešle editaci
                     a jejich události se zastaví dřív, než dojdou k formuláři (viz JS) -->
                <span class="pv-lp-custom-size" hidden>
                    <input type="number" class="form-control form-control-sm" form="pv-lp-no-form" min="200" max="3840" step="1" inputmode="numeric" aria-label="${t('customWidthLabel', 'Width')}">
                    <span aria-hidden="true">×</span>
                    <input type="number" class="form-control form-control-sm" form="pv-lp-no-form" min="200" max="3840" step="1" inputmode="numeric" aria-label="${t('customHeightLabel', 'Height')}">
                </span>
                <button type="button" class="btn btn-sm btn-outline-secondary rotate-btn" title="${t('rotateTitle', 'Rotate (portrait / landscape)')}" aria-pressed="false"><i class="fas fa-redo-alt"></i></button>
                <button type="button" class="btn btn-sm btn-outline-secondary scale-btn" title="${t('scaleTitle', 'Scale: fit to panel / 100 %')}" aria-pressed="false"><i class="fas fa-search me-1"></i><span class="pv-lp-scale-label">100 %</span></button>
                <button type="button" class="btn btn-sm btn-outline-secondary display-type-btn" title="${t('displayTypeTitle', 'Display type: Detail / Summary (how the item looks in a list)')}" aria-pressed="false"><i class="fas fa-file-alt me-1"></i><span class="pv-lp-display-label">Detail</span></button>

                <div class="pv-toolbar-separator"></div>

                <button type="button" class="btn btn-sm btn-outline-secondary auto-update-btn" title="${t('autoUpdateTitle', 'Automatic update')}" aria-pressed="false"><i class="fas fa-bolt"></i></button>
                <button type="button" class="btn btn-sm btn-outline-secondary refresh-btn" title="${t('refreshTitle', 'Refresh preview')}"><i class="fas fa-sync-alt"></i></button>

                <div class="pv-toolbar-separator"></div>

                <button type="button" class="btn btn-sm btn-outline-secondary auto-scroll-btn" title="${t('autoScrollTitle', 'Scroll to changes')}" aria-pressed="false"><i class="fas fa-crosshairs"></i></button>
                <button type="button" class="btn btn-sm btn-outline-info state-fullscreen-btn" title="${t('fullscreenTitle', 'Fullscreen')}"><i class="fas fa-arrows-alt"></i></button>
                <button type="button" class="btn btn-sm btn-outline-info detach-btn" title="${t('detachTitle', 'Open in a separate window')}"><i class="fas fa-external-link-alt"></i></button>
                <button type="button" class="btn btn-sm btn-outline-danger state-hide-btn" title="${t('hidePreviewTitle', 'Hide Live Preview')}"><i class="fas fa-eye-slash"></i></button>

                <div class="pv-toolbar-separator"></div>

                <button type="button" class="btn btn-sm btn-outline-secondary help-btn" title="${t('helpTitle', 'Help')}"><i class="fas fa-question"></i></button>
            </div>
            <div class="pv-live-preview-info">
                <span class="pv-lp-info-item" title="${t('infoRenderedTitle', 'Time of the last preview update')}"><i class="far fa-clock" aria-hidden="true"></i> <span class="pv-lp-info-time">–</span></span>
                <span class="pv-lp-info-item" title="${t('infoServerTitle', 'Server response time – from sending the form to receiving the rendered page')}">${t('infoServer', 'Server')} <span class="pv-lp-info-server">–</span></span>
                <span class="pv-lp-info-item" title="${t('infoLoadTitle', 'Page load time in the preview – styles, scripts and images of the theme')}">${t('infoLoad', 'Load')} <span class="pv-lp-info-load">–</span></span>
                <span class="pv-lp-info-item pv-lp-info-culture-item" title="${t('infoCultureTitle', 'Language (culture) in which the preview was rendered – the culture of the content item')}" hidden><i class="fas fa-globe" aria-hidden="true"></i> <span class="pv-lp-info-culture"></span></span>
                <span class="pv-lp-info-item" title="${t('infoViewportTitle', 'Viewport of the preview (width × height in CSS pixels) and its current scale')}"><i class="fas fa-vector-square" aria-hidden="true"></i> <span class="pv-lp-info-viewport">–</span></span>
            </div>
            <div class="pv-live-preview-validation" role="alert" hidden></div>
            <!-- Stage se neposouvá: stavová zpráva a upozornění zůstanou na místě,
                 i když se plátno v měřítku 100 % posouvá -->
            <div class="pv-live-preview-stage">
                <div class="pv-live-preview-status" role="status" aria-live="polite"></div>
                <div class="pv-live-preview-notice" role="status" aria-live="polite"></div>
                <div class="pv-lp-credit">
                    PV Live Preview &middot; &copy; <a href="${AUTHOR_URL}" target="_blank" rel="noopener" title="${t('authorLinkTitle', 'Visit the author’s website')}">Patrik Volka</a>
                </div>
                <div class="pv-live-preview-canvas">
                    <div class="pv-device-wrapper">
                        <div class="pv-device-mockup" data-device="desktop">
                            <iframe class="pv-live-preview-iframe is-active" sandbox="${PREVIEW_SANDBOX}"></iframe>
                            <iframe class="pv-live-preview-iframe" sandbox="${PREVIEW_SANDBOX}" aria-hidden="true" tabindex="-1"></iframe>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    const panelWrapper = document.createElement('div');
    panelWrapper.innerHTML = panelHtml.trim();
    const panel = panelWrapper.firstChild;

    // Vestavěná zařízení, která typ obsahu nezobrazuje (null / chybějící = všechna)
    if (Array.isArray(settings.devices)) {
        const enabled = new Set(settings.devices);
        panel.querySelectorAll('.device-btn:not(.pv-lp-preset-btn)').forEach(btn => {
            if (!enabled.has(btn.dataset.device)) btn.remove();
        });
    }

    // Plovoucí tlačítko pro obnovení skrytého náhledu
    const floatingBtn = document.createElement('button');
    floatingBtn.type = 'button';
    floatingBtn.className = 'btn btn-primary pv-floating-toggle';
    floatingBtn.innerHTML = `<i class="fas fa-eye"></i> ${t('showLivePreview', 'Show Live Preview')}`;
    // Viditelnost řídí atribut hidden, ne CSS display: Bootstrap .btn { display: inline-block }
    // má stejnou specificitu jako naše třída a styly admin tématu se načítají až po našich.
    floatingBtn.hidden = true;
    document.body.appendChild(floatingBtn);

    // Formulář zůstává na svém místě v DOM – přesun elementu by znovu načetl
    // iframy uvnitř (TinyMCE apod.) a editory by přišly o obsah.
    // Panel se vloží jako poslední potomek formuláře a rozložení řeší CSS grid.
    // Panel neobsahuje žádné pojmenované inputy, takže neovlivní odesílaná data.
    form.classList.add('pv-lp-form', `pv-lp-${position}`);
    form.appendChild(panel);

    // Panel musí v gridu pokrýt všechny řádky, které zabírá obsah formuláře.
    // Prázdné nadbytečné řádky mají nulovou výšku (row-gap: 0), proto stačí počet potomků.
    const updatePanelRowSpan = () => {
        panel.style.gridRow = `1 / span ${Math.max(form.children.length, 1)}`;
    };
    updatePanelRowSpan();
    new MutationObserver(updatePanelRowSpan).observe(form, { childList: true });

    const canvas = panel.querySelector('.pv-live-preview-canvas');
    const wrapper = panel.querySelector('.pv-device-wrapper');
    const mockup = panel.querySelector('.pv-device-mockup');
    // Dva iframy pro aktualizaci bez bliknutí: viditelný (activeFrame) a skrytý (backFrame),
    // do kterého se vykresluje nová verze. Po jejím načtení se role prohodí.
    // Když je náhled v samostatném okně, ukazují tyto proměnné na iframy a prvky okna
    // (viz „SAMOSTATNÉ OKNO“) – veškerá logika vykreslování tak funguje beze změny.
    let [activeFrame, backFrame] = panel.querySelectorAll('.pv-live-preview-iframe');
    let statusEl = panel.querySelector('.pv-live-preview-status');

    // --- STAVOVÁ ZPRÁVA (načítání / chyba) ---
    const setStatus = (type, text) => {
        statusEl.className = 'pv-live-preview-status' + (type ? ` is-${type}` : '');
        statusEl.textContent = '';
        if (!type) return;

        if (type === 'loading') {
            const spinner = document.createElement('span');
            spinner.className = 'spinner-border spinner-border-sm me-2';
            spinner.setAttribute('aria-hidden', 'true');
            statusEl.appendChild(spinner);
        }
        // textContent – text z odpovědi serveru se nikdy nevkládá jako HTML
        statusEl.appendChild(document.createTextNode(text));
    };

    // --- LOGIKA STAVŮ (Split, Fullscreen, Skryto) ---
    let currentState = 'split';
    const fullscreenBtn = panel.querySelector('.state-fullscreen-btn');
    const hideBtn = panel.querySelector('.state-hide-btn');

    // Ukládané stavy. 'detached' (náhled v samostatném okně) se neukládá nikdy –
    // okno obnovení stránky nepřežije.
    const STATES = ['split', 'fullscreen', 'hidden'];

    // Lišta „Náhled je v samostatném okně“ (stav 'detached'); tlačítka obsluhuje sekce SAMOSTATNÉ OKNO
    const detachedBar = document.createElement('div');
    detachedBar.className = 'pv-lp-detached-bar';
    detachedBar.setAttribute('role', 'status');
    detachedBar.hidden = true;
    detachedBar.innerHTML = `
        <i class="fas fa-external-link-alt" aria-hidden="true"></i>
        <span>${t('detachedMessage', 'Live preview is open in a separate window.')}</span>
        <button type="button" class="btn btn-sm btn-primary pv-lp-focus-window">${t('focusWindow', 'Show window')}</button>
        <button type="button" class="btn btn-sm btn-outline-secondary pv-lp-window-refresh" title="${t('refreshTitle', 'Refresh preview')}"><i class="fas fa-sync-alt"></i></button>
        <button type="button" class="btn btn-sm btn-outline-secondary pv-lp-attach">${t('attachPreview', 'Return to panel')}</button>`;
    document.body.appendChild(detachedBar);

    const updateState = (newState, save = true) => {
        currentState = newState;
        // Stav se pamatuje napříč typy obsahu – jde o volbu pracovního postupu, ne o typ.
        // save = false: stav vynucený nastavením typu („skrytý při otevření“) nebo samostatným
        // oknem – volbu uživatele nepřepisujeme.
        if (save && STATES.includes(newState)) storage.set('state', newState);

        // Skrytý panel i náhled v okně: grid se vypne, aby formulář zabral celou šířku
        const panelHidden = currentState === 'hidden' || currentState === 'detached';
        form.classList.toggle('pv-lp-collapsed', panelHidden);
        floatingBtn.hidden = currentState !== 'hidden';
        detachedBar.hidden = currentState !== 'detached';

        if (panelHidden) {
            panel.style.display = 'none';
        }
        else if (currentState === 'fullscreen') {
            panel.style.display = 'flex';
            panel.classList.add('pv-fullscreen');

            fullscreenBtn.innerHTML = '<i class="fas fa-compress"></i>';
            fullscreenBtn.title = `${translations.exitFullscreenTitle || 'Exit Fullscreen'} (Esc, ${SHORTCUTS.fullscreen})`;
            fullscreenBtn.classList.replace('btn-outline-info', 'btn-info');
        }
        else { // 'split'
            panel.style.display = 'flex';
            panel.classList.remove('pv-fullscreen');

            fullscreenBtn.innerHTML = '<i class="fas fa-arrows-alt"></i>';
            fullscreenBtn.title = `${translations.fullscreenTitle || 'Fullscreen'} (${SHORTCUTS.fullscreen})`;
            fullscreenBtn.classList.replace('btn-info', 'btn-outline-info');
        }

        // Nutné pro přepočítání zoomu iframu po změně layoutu
        setTimeout(updateScale, 100);
    };

    const showPreview = () => {
        updateState('split');
        // Ve skrytém stavu se náhled neaktualizuje (a při otevření stránky ve skrytém
        // stavu ještě nebyl vykreslen vůbec) – obnovíme ho hned, ne až kontrolou otisku.
        // V ručním režimu jen poprvé; jinak změny označí tlačítko Obnovit.
        if (lastSignature === null || (autoUpdate && getFormSignature() !== lastSignature)) {
            scheduleUpdate(0);
        }
    };

    hideBtn.addEventListener('click', () => updateState('hidden'));
    floatingBtn.addEventListener('click', showPreview);
    fullscreenBtn.addEventListener('click', () => {
        if (currentState === 'detached') return;
        updateState(currentState === 'fullscreen' ? 'split' : 'fullscreen');
    });

    // --- OKNO NÁPOVĚDY ---
    // Obsah (lokalizovaný v Razoru) je v <template> uvnitř markeru. Nativní <dialog>
    // se vkládá do body: showModal() ho zobrazí v top layer nad vším, i nad panelem
    // v režimu celé obrazovky, sám řeší fokus i zavření klávesou Esc.
    const helpBtn = panel.querySelector('.help-btn');
    const helpTemplate = marker.querySelector('template.pv-lp-help-template');
    const helpDialog = helpTemplate?.content.querySelector('dialog.pv-lp-help')?.cloneNode(true) ?? null;

    if (helpDialog && typeof helpDialog.showModal === 'function') {
        document.body.appendChild(helpDialog);

        helpBtn.addEventListener('click', () => helpDialog.showModal());
        helpDialog.querySelector('.pv-lp-help-close')?.addEventListener('click', () => helpDialog.close());
        // Klik na ztmavené pozadí (mimo obsah okna) dialog zavře
        helpDialog.addEventListener('click', (e) => {
            if (e.target === helpDialog) helpDialog.close();
        });
    } else {
        helpBtn.remove();
        // Oddělovač před tlačítkem nápovědy by zůstal viset na konci lišty
        panel.querySelector('.pv-live-preview-toolbar > .pv-toolbar-separator:last-of-type')?.remove();
    }

    // --- KLÁVESOVÉ ZKRATKY ---
    //   Alt+Shift+L       skrýt / zobrazit náhled (L = Live)
    //   Alt+Shift+1…6     přepnout zařízení (v pořadí tlačítek v toolbaru)
    //   Alt+Shift+O       otočit zařízení (O = orientace)
    //   Alt+Shift+0       měřítko: přizpůsobit / 100 % (obdoba Ctrl+0 v prohlížeči)
    //   Alt+Shift+D       display type: Detail / Summary
    //   Alt+Shift+Enter   celá obrazovka v panelu (zapnout / vypnout)
    //   Alt+Shift+R       obnovit náhled (hlavně pro ruční režim)
    //   Alt+Shift+W       otevřít náhled v samostatném okně / vrátit do panelu (W = window)
    //   Esc               ukončit celou obrazovku
    //
    // Prefix Alt+Shift byl zvolen tak, aby zkratky nekolidovaly s běžnými zkratkami:
    //  - Ctrl+Shift+písmeno mají prohlížeče většinou obsazené (Firefox Ctrl+Shift+P =
    //    anonymní okno, Ctrl+Shift+R/T/N/B/O/I/J…), v editorech Ctrl+Shift+Z/V apod.;
    //  - F11 je celá obrazovka prohlížeče, Alt+písmeno otevírá jeho menu (Alt+F, Alt+E…),
    //    Alt+číslice přepíná ve Firefoxu na Linuxu záložky;
    //  - Ctrl+Alt na Windows = AltGr, kterým se na české klávesnici píšou znaky (€ @ { } [ ] …);
    //  - Monaco (pole s kódem) používá Alt+Shift+F a Alt+Shift+šipky – ty nepoužíváme.
    // Klávesy se porovnávají podle e.code (fyzická klávesa), ne e.key: na české
    // klávesnici dává horní řada „ě, š, č…“ a s Altem se e.key liší podle rozložení.
    const SHORTCUTS = {
        toggle: 'Alt+Shift+L',
        fullscreen: 'Alt+Shift+Enter',
        refresh: 'Alt+Shift+R',
        rotate: 'Alt+Shift+O',
        zoom: 'Alt+Shift+0',
        displayType: 'Alt+Shift+D',
        detach: 'Alt+Shift+W',
        device: (n) => `Alt+Shift+${n}`
    };

    const toggleFullscreen = () => {
        // Celá obrazovka je režim panelu – s náhledem v okně nemá smysl
        if (currentState === 'detached') return;
        if (currentState === 'fullscreen') {
            updateState('split');
        } else {
            updateState('fullscreen');
            // Náhled skrytý od otevření stránky ještě nebyl vykreslen
            if (lastSignature === null) scheduleUpdate(0);
        }
    };

    const onKeyDown = (e) => {
        // V otevřené nápovědě zkratky nefungují; Esc v ní zavře jen nápovědu
        if (helpDialog?.open || e.repeat) return;

        if (e.key === 'Escape') {
            if (currentState === 'fullscreen') {
                e.preventDefault();
                updateState('split');
            }
            return;
        }

        // Jen Alt+Shift, bez Ctrl (AltGr) a bez Cmd
        if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;

        let handled = true;
        const digit = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);

        if (e.code === 'KeyL') {
            if (currentState === 'detached') {
                // Náhled je v okně – zkratka ho jen přenese do popředí
                focusWindow();
            } else if (currentState === 'hidden') {
                showPreview();
            } else {
                updateState('hidden');
            }
        } else if (e.code === 'KeyW') {
            toggleWindow();
        } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
            toggleFullscreen();
        } else if (e.code === 'KeyR') {
            // Ve skrytém stavu se neobnovuje – updatePreview by stejně nic neudělal
            if (currentState !== 'hidden') refreshBtn.click();
        } else if (e.code === 'KeyO') {
            rotate();
        } else if (e.code === 'Digit0' || e.code === 'Numpad0') {
            toggleZoom();
        } else if (e.code === 'KeyD') {
            toggleDisplayType();
        } else if (digit && deviceBtns[Number(digit[1]) - 1]) {
            deviceBtns[Number(digit[1]) - 1].click();
        } else {
            handled = false;
        }

        if (handled) e.preventDefault();
    };
    document.addEventListener('keydown', onKeyDown);

    // Zkratka v tooltipu tlačítka
    const addShortcutToTitle = (element, shortcut) => {
        element.title = `${element.title} (${shortcut})`;
    };
    addShortcutToTitle(hideBtn, SHORTCUTS.toggle);
    addShortcutToTitle(floatingBtn, SHORTCUTS.toggle);
    // Po změně stavu tooltip přepíše updateState (i se zkratkou)
    addShortcutToTitle(fullscreenBtn, SHORTCUTS.fullscreen);
    addShortcutToTitle(panel.querySelector('.detach-btn'), SHORTCUTS.detach);

    // TinyMCE píše do vlastního iframu – klávesy z něj do dokumentu administrace nedojdou.
    // Připojíme se k již vytvořeným editorům i k těm, které vzniknou později.
    // Až po načtení stránky – skript TinyMCE se může načíst až po našem.
    const attachTinyMce = () => {
        try {
            if (!window.tinymce) return;
            const attachEditor = (editor) => editor?.on?.('keydown', onKeyDown);
            (window.tinymce.get?.() || []).forEach(attachEditor);
            window.tinymce.on?.('AddEditor', (e) => attachEditor(e.editor));
        } catch (e) {}
    };
    if (document.readyState === 'complete') {
        attachTinyMce();
    } else {
        window.addEventListener('load', attachTinyMce, { once: true });
    }

    // --- VALIDAČNÍ CHYBY (žlutý pruh nad náhledem) ---
    // Server je posílá v hlavičce jako URL-kódovaný JSON pole zpráv. Chybějící hlavička = bez chyb.
    const VALIDATION_HEADER = 'X-PV-LivePreview-Errors';
    // let – v samostatném okně ukazuje na pruh okna
    let validationEl = panel.querySelector('.pv-live-preview-validation');

    const readValidationErrors = (response) => {
        const raw = response.headers.get(VALIDATION_HEADER);
        if (raw == null) return null;
        try {
            const parsed = JSON.parse(decodeURIComponent(raw));
            return Array.isArray(parsed) ? parsed.filter(m => typeof m === 'string') : [];
        } catch (e) {
            // Neplatná hlavička – víme jen, že chyby jsou; zobrazí se obecný text
            return [];
        }
    };

    // Pruh se překresluje jen při změně seznamu – role="alert" by jinak čtečce
    // obrazovky ohlašovala stejné chyby při každém stisku klávesy.
    let shownErrorsKey = null;
    const showValidationErrors = (errors) => {
        const key = errors ? JSON.stringify(errors) : null;
        if (key === shownErrorsKey) return;
        shownErrorsKey = key;

        validationEl.textContent = '';
        validationEl.hidden = !errors;
        if (!errors) return;

        const title = document.createElement('div');
        title.className = 'pv-lp-validation-title';
        const icon = document.createElement('i');
        icon.className = 'fas fa-exclamation-triangle me-2';
        icon.setAttribute('aria-hidden', 'true');
        title.append(icon, document.createTextNode(
            translations.validationErrors || 'The content contains errors and cannot be saved in this state:'));
        validationEl.appendChild(title);

        if (errors.length) {
            const list = document.createElement('ul');
            errors.forEach(message => {
                const item = document.createElement('li');
                // textContent – zprávy ze serveru se nikdy nevkládají jako HTML
                item.textContent = message;
                list.appendChild(item);
            });
            validationEl.appendChild(list);
        }
    };

    // --- KRÁTKÉ UPOZORNĚNÍ NAD NÁHLEDEM (např. zablokovaný formulář) ---
    // let – v samostatném okně ukazuje na upozornění okna
    let noticeEl = panel.querySelector('.pv-live-preview-notice');
    let noticeTimer = null;
    const showNotice = (text) => {
        noticeEl.textContent = text;
        noticeEl.classList.add('is-visible');
        clearTimeout(noticeTimer);
        noticeTimer = setTimeout(() => noticeEl.classList.remove('is-visible'), 3000);
    };

    // --- ZACHYCENÍ ODKAZŮ A FORMULÁŘŮ V NÁHLEDU ---
    // Kliknutí na odkaz by přepnulo iframe na jinou stránku webu a živý náhled by se ztratil.
    // Kotvy ("#sekce") posouváme sami – scrollTo okna iframu (bez scrollIntoView, který
    // by posouval i administraci) a nezávisle na základní URL dokumentu náhledu.
    const scrollToAnchor = (win, hash) => {
        const doc = win.document;
        let id = hash.slice(1);
        try { id = decodeURIComponent(id); } catch (e) {}
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        const behavior = reduceMotion ? 'instant' : 'smooth';

        // Samotné "#" (nebo "#top") vede podle HTML na začátek stránky
        if (!id || id.toLowerCase() === 'top') {
            win.scrollTo({ top: 0, behavior });
            return;
        }
        const target = doc.getElementById(id) || doc.getElementsByName(id)[0];
        if (target) {
            // scrollTo okna iframu, ne scrollIntoView – to by posouvalo i administraci
            win.scrollTo({ top: win.scrollY + target.getBoundingClientRect().top, behavior });
        }
    };

    const onPreviewClick = (e) => {
        // Kliknutí už obsloužil skript tématu (menu, lightbox, záložky, plynulý posun…)
        if (e.defaultPrevented || e.button !== 0) return;

        const link = e.target.closest?.('a[href]');
        if (!link) return;

        const win = link.ownerDocument.defaultView;
        const href = link.getAttribute('href').trim();

        if (href.startsWith('#')) {
            e.preventDefault();
            scrollToAnchor(win, href);
            return;
        }

        // Jen webové odkazy; mailto:, tel:, javascript: apod. iframe nepřesměrují
        let url;
        // Ne link.href – u odkazu v SVG to není řetězec (SVGAnimatedString)
        try { url = new URL(href, link.baseURI); } catch (err) { return; }
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

        // target="_blank" otevře novou záložku i bez nás. Každý jiný cíl (_self, _top,
        // _parent, pojmenovaný rámec) by přesměroval náhled nebo dokonce celou administraci.
        if ((link.getAttribute('target') || '').toLowerCase() === '_blank') return;

        e.preventDefault();
        // Volání přímo v obsluze kliknutí – blokátor oken ho propustí
        window.open(url.href, '_blank', 'noopener');
    };

    // Formuláře tématu (kontakt, newsletter…) by se odeslaly doopravdy.
    // Odeslání blokuje sandbox iframu (bez allow-forms) – i programové form.submit().
    // Prohlížeč ho ale zastaví dřív, než vyvolá událost submit, takže hlášku ukážeme
    // už při kliknutí na odesílací tlačítko. Zachytává se ve fázi capture na window,
    // tedy dřív než obsluha tématu – ani AJAXový formulář navázaný na kliknutí data nepošle.
    const blockSubmit = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        showNotice(translations.formSubmitBlocked || 'Form submission is disabled in the preview.');
    };

    const onPreviewSubmitClick = (e) => {
        const control = e.target.closest?.('button, input[type="submit"], input[type="image"]');
        if (!control?.form) return;
        // <button> bez type je odesílací
        const type = (control.getAttribute('type') || (control.tagName === 'BUTTON' ? 'submit' : '')).toLowerCase();
        if (type === 'submit' || type === 'image') blockSubmit(e);
    };

    // Posluchače dokumentu náhledu – připojují se po každém načtení iframu (každé načtení
    // vytvoří nový dokument i window). Iframy mají allow-same-origin, přístup je tedy možný.
    // Funkce se volá pro iframy panelu i samostatného okna.
    const attachPreviewDocumentListeners = (frame) => frame.addEventListener('load', () => {
        try {
            const win = frame.contentWindow;
            if (!win || win.location.href === 'about:blank') return;
            // Když je fokus uvnitř náhledu, klávesy jdou do dokumentu iframu, ne do administrace
            win.document.addEventListener('keydown', onKeyDown);
            // Kliknutí v bublací fázi, aby šlo poznat, že ho téma už obsloužilo (defaultPrevented)
            win.document.addEventListener('click', onPreviewClick);
            win.addEventListener('click', onPreviewSubmitClick, true);
            // Pojistka pro prohlížeče, které submit vyvolají i v sandboxu
            win.addEventListener('submit', blockSubmit, true);
        } catch (e) {}
    });
    [activeFrame, backFrame].forEach(attachPreviewDocumentListeners);

    // --- ZMĚNA ŠÍŘKY PANELU TÁHLEM (pozice vlevo / vpravo) ---
    if (position === 'left' || position === 'right') {
        const MIN_PANEL_WIDTH = 300;
        const MIN_FORM_WIDTH = 300;
        const COLUMN_GAP = 20;

        const resizer = document.createElement('div');
        resizer.className = 'pv-lp-resizer';
        resizer.title = translations.resizeTitle || 'Drag to resize, double-click to reset';
        panel.appendChild(resizer);

        // Šířka, kterou si uživatel zvolil; skutečná se omezí podle aktuální šířky formuláře
        let preferredWidth = null;

        const applyPanelWidth = () => {
            if (preferredWidth == null) {
                form.style.removeProperty('--pv-lp-panel-width');
                return;
            }
            const maxWidth = Math.max(MIN_PANEL_WIDTH, form.clientWidth - COLUMN_GAP - MIN_FORM_WIDTH);
            const width = Math.min(Math.max(preferredWidth, MIN_PANEL_WIDTH), maxWidth);
            form.style.setProperty('--pv-lp-panel-width', `${Math.round(width)}px`);
        };

        // Uložená šířka
        const savedWidth = parseInt(storage.get('panel-width'), 10);
        if (savedWidth > 0) preferredWidth = savedWidth;
        applyPanelWidth();

        window.addEventListener('resize', applyPanelWidth);

        resizer.addEventListener('pointerdown', (e) => {
            if (currentState !== 'split' || e.button !== 0) return;
            e.preventDefault();

            const startX = e.clientX;
            const startWidth = panel.getBoundingClientRect().width;
            resizer.setPointerCapture(e.pointerId);
            form.classList.add('pv-lp-resizing');

            const onMove = (ev) => {
                const dx = ev.clientX - startX;
                // Panel vpravo roste tažením doleva, panel vlevo tažením doprava
                preferredWidth = position === 'right' ? startWidth - dx : startWidth + dx;
                applyPanelWidth();
            };

            const onEnd = () => {
                resizer.removeEventListener('pointermove', onMove);
                resizer.removeEventListener('pointerup', onEnd);
                resizer.removeEventListener('pointercancel', onEnd);
                form.classList.remove('pv-lp-resizing');
                storage.set('panel-width', Math.round(preferredWidth ?? startWidth));
            };

            resizer.addEventListener('pointermove', onMove);
            resizer.addEventListener('pointerup', onEnd);
            resizer.addEventListener('pointercancel', onEnd);
        });

        // Dvojklik vrátí výchozí rozdělení napůl
        resizer.addEventListener('dblclick', () => {
            preferredWidth = null;
            applyPanelWidth();
            storage.remove('panel-width');
        });
    }


    // --- INFORMAČNÍ LIŠTA ---
    // Čas poslední aktualizace, odezva serveru, doba načtení stránky v náhledu a viewport.
    // Měří se na klientu (performance.now), takže časy zahrnují i síť – na localhostu zanedbatelnou.
    const infoTimeEl = panel.querySelector('.pv-lp-info-time');
    const infoServerEl = panel.querySelector('.pv-lp-info-server');
    const infoLoadEl = panel.querySelector('.pv-lp-info-load');
    const infoViewportEl = panel.querySelector('.pv-lp-info-viewport');
    // Od kolika ms se čas zvýrazní jako pomalý (ladění výkonu šablon)
    const SLOW_SERVER_MS = 1000;
    const SLOW_LOAD_MS = 1500;

    const formatMs = (ms) => `${Math.round(ms)} ms`;

    const infoCultureItem = panel.querySelector('.pv-lp-info-culture-item');
    const infoCultureEl = panel.querySelector('.pv-lp-info-culture');

    const renderInfoTiming = ({ serverMs, loadMs, culture }) => {
        // Kultura položky (LocalizationPart); bez ní se náhled vykreslil v kultuře administrace
        infoCultureItem.hidden = !culture;
        infoCultureEl.textContent = culture || '';
        infoTimeEl.textContent = new Date().toLocaleTimeString();
        infoServerEl.textContent = formatMs(serverMs);
        infoServerEl.classList.toggle('is-slow', serverMs >= SLOW_SERVER_MS);
        infoLoadEl.textContent = formatMs(loadMs);
        infoLoadEl.classList.toggle('is-slow', loadMs >= SLOW_LOAD_MS);
    };

    const renderInfoViewport = (scale) => {
        // Rozměr iframu = viewport stránky v CSS pixelech (transform makety ho nemění)
        const frame = panel.querySelector('.pv-live-preview-iframe.is-active');
        const width = frame?.clientWidth || 0;
        const height = frame?.clientHeight || 0;
        infoViewportEl.textContent = width && height
            ? `${width} × ${height} @ ${Math.round(scale * 100)} %`
            : '–';
    };

    // --- MĚŘÍTKO MAKETY (Přizpůsobit / 100 %) ---
    // 'fit'    = maketa se zmenší, aby se vešla do panelu (výchozí)
    // 'actual' = skutečná velikost 1:1, plátno dostane posuvníky – pro kontrolu detailů
    const scaleBtn = panel.querySelector('.scale-btn');
    const scaleLabel = scaleBtn.querySelector('.pv-lp-scale-label');
    let zoomMode = storage.get('zoom') === 'actual' ? 'actual' : 'fit';

    const renderScaleBtn = (scale, isFluid) => {
        scaleLabel.textContent = `${Math.round(scale * 100)} %`;
        renderInfoViewport(scale);
        const isActual = zoomMode === 'actual';
        scaleBtn.classList.toggle('btn-secondary', isActual);
        scaleBtn.classList.toggle('btn-outline-secondary', !isActual);
        scaleBtn.setAttribute('aria-pressed', String(isActual));
        // Fluid vyplňuje panel, měřítko u něj nemá smysl
        scaleBtn.disabled = isFluid;
    };

    const updateScale = () => {
        // Panel není vidět (skrytý, nebo náhled v samostatném okně)
        if (currentState === 'hidden' || currentState === 'detached') return;

        const deviceType = mockup.getAttribute('data-device');
        const isFluid = deviceType === 'fluid';
        const isActual = zoomMode === 'actual' && !isFluid;
        canvas.classList.toggle('pv-lp-actual-size', isActual);

        if (isFluid) {
            wrapper.style.transform = 'none';
            wrapper.style.width = '100%';
            wrapper.style.height = '100%';
            renderScaleBtn(1, true);
            return;
        }
        wrapper.style.width = 'auto';
        wrapper.style.height = 'auto';

        let scale = 1;
        if (!isActual) {
            const mockupW = mockup.offsetWidth;
            let mockupH = mockup.offsetHeight;
            if (deviceType === 'desktop') mockupH += 80;

            const availableW = canvas.clientWidth - 40;
            const availableH = canvas.clientHeight - 40;

            if (mockupW > availableW || mockupH > availableH) {
                scale = Math.min(availableW / mockupW, availableH / mockupH);
            }
        }

        // transform nemění layoutový rozměr – v režimu 100 % proto posuvníky plátna
        // odpovídají skutečné velikosti makety
        wrapper.style.transform = scale === 1 ? 'none' : `scale(${scale})`;
        renderScaleBtn(scale, false);
    };

    const toggleZoom = () => {
        if (scaleBtn.disabled) return;
        zoomMode = zoomMode === 'actual' ? 'fit' : 'actual';
        storage.set('zoom', zoomMode);
        updateScale();
        // Po přepnutí na 100 % začne prohlížení od levého horního rohu makety
        if (zoomMode === 'actual') canvas.scrollTo(0, 0);
    };
    scaleBtn.addEventListener('click', toggleZoom);

    // Měřítko se přepočítá při změně plátna (resize panelu, okna, fullscreen)
    // i při změně makety. Maketa má CSS transition na šířku/výšku, takže jednorázové
    // měření po přepnutí zařízení by zachytilo rozměr uprostřed animace.
    // ResizeObserver hlásí změny průběžně během animace i po jejím doběhnutí.
    // (transform na wrapperu layoutový rozměr makety nemění, nevznikne tedy smyčka.)
    const resizeObserver = new ResizeObserver(() => updateScale());
    resizeObserver.observe(canvas);
    resizeObserver.observe(mockup);

    // Pojistka: finální přepočet po doběhnutí animace (např. změna jen šířky rámečku)
    mockup.addEventListener('transitionend', (e) => {
        if (e.target === mockup) updateScale();
    });

    // --- PŘEPÍNÁNÍ ZAŘÍZENÍ ---
    // Zařízení = id tlačítka + orientace:
    //  - vestavěná: fluid, mobile, tablet, laptop, desktop – makety v CSS ("mobile-p", "mobile-l"…),
    //  - custom: rozměr zadaný uživatelem v toolbaru (při otočení se prohodí šířka ↔ výška),
    //  - preset:{název}: vlastní zařízení z nastavení typu obsahu (maketa "custom" s pevným rozměrem).
    const DEFAULT_DEVICE = 'laptop';
    const ROTATABLE_DEVICES = new Set(['mobile', 'tablet']);
    const presetById = new Map(presets.map(p => [p.id, p]));
    // Zařízení se pamatuje zvlášť pro každý typ obsahu (článek typicky na mobilu, landing page na desktopu).
    // Formát: "mobile-l" / "tablet-p" (beze změny proti dřívějším verzím), "preset:{název}|l"
    // u vlastních zařízení, jinak samotné id.
    const DEVICE_STORAGE_KEY = `device:${serverContentType || '*'}`;
    const deviceBtns = [...panel.querySelectorAll('.device-btn')];
    const rotateBtn = panel.querySelector('.rotate-btn');
    const customSizeEl = panel.querySelector('.pv-lp-custom-size');
    const [customWidthInput, customHeightInput] = customSizeEl.querySelectorAll('input');

    let currentDevice = DEFAULT_DEVICE;
    let landscape = false;

    // --- Vlastní rozměr ---
    const CUSTOM_MIN = 200;
    const CUSTOM_MAX = 3840;
    const DEFAULT_CUSTOM_SIZE = { width: 412, height: 915 };

    const parseSize = (value) => {
        const match = /^(\d+)x(\d+)$/.exec(value || '');
        if (!match) return null;
        const width = Number(match[1]);
        const height = Number(match[2]);
        const valid = (n) => n >= CUSTOM_MIN && n <= CUSTOM_MAX;
        return valid(width) && valid(height) ? { width, height } : null;
    };

    // Vlastní rozměr je společný pro všechny typy obsahu (jde o konkrétní testované zařízení)
    let customSize = parseSize(storage.get('custom-size')) || { ...DEFAULT_CUSTOM_SIZE };

    // Rozměr makety "custom" pro aktuální zařízení (vlastní rozměr nebo vlastní zařízení)
    const applyDeviceSize = () => {
        let size = null;
        if (currentDevice === 'custom') {
            size = customSize;
        } else if (presetById.has(currentDevice)) {
            const preset = presetById.get(currentDevice);
            size = landscape
                ? { width: preset.height, height: preset.width }
                : { width: preset.width, height: preset.height };
        }
        if (!size) return;
        // CSSOM (setProperty) projde i při CSP bez 'unsafe-inline'
        mockup.style.setProperty('--pv-lp-custom-width', `${size.width}px`);
        mockup.style.setProperty('--pv-lp-custom-height', `${size.height}px`);
        setTimeout(updateScale, 50);
    };

    const applyCustomSize = () => {
        // Hodnotu v poli nepřepisujeme, když do něj uživatel právě píše
        if (document.activeElement !== customWidthInput) customWidthInput.value = customSize.width;
        if (document.activeElement !== customHeightInput) customHeightInput.value = customSize.height;
        applyDeviceSize();
    };

    const onCustomSizeInput = () => {
        const width = Number(customWidthInput.value);
        const height = Number(customHeightInput.value);
        const valid = (n) => Number.isInteger(n) && n >= CUSTOM_MIN && n <= CUSTOM_MAX;
        customWidthInput.classList.toggle('is-invalid', !valid(width));
        customHeightInput.classList.toggle('is-invalid', !valid(height));
        // Neplatnou (rozepsanou) hodnotu ignorujeme, maketa zůstane na poslední platné
        if (!valid(width) || !valid(height)) return;
        customSize = { width, height };
        storage.set('custom-size', `${width}x${height}`);
        applyCustomSize();
    };

    [customWidthInput, customHeightInput].forEach(input => {
        // Události nesmí dojít k editačnímu formuláři – 'input' by spustil aktualizaci náhledu
        ['input', 'change'].forEach(type => input.addEventListener(type, (e) => {
            e.stopPropagation();
            if (type === 'input') onCustomSizeInput();
        }));
        // Po opuštění pole se vrátí poslední platná hodnota
        input.addEventListener('blur', () => {
            input.classList.remove('is-invalid');
            applyCustomSize();
        });
        // Enter jen potvrdí hodnotu (pole s form="…" mimo formulář editaci stejně neodešle)
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            }
        });
    });

    // --- Výběr zařízení a otočení ---
    // Zařízení s orientací řízenou příznakem landscape (vlastní rozměr se místo toho prohazuje)
    const hasOrientation = (device) => ROTATABLE_DEVICES.has(device) || presetById.has(device);

    const getMockupKey = () => {
        if (ROTATABLE_DEVICES.has(currentDevice)) return `${currentDevice}-${landscape ? 'l' : 'p'}`;
        // Vlastní zařízení používají maketu vlastního rozměru (rozměr přes CSS proměnné)
        if (presetById.has(currentDevice)) return 'custom';
        return currentDevice;
    };

    const getStoredDeviceKey = () => {
        if (ROTATABLE_DEVICES.has(currentDevice)) return getMockupKey();
        if (presetById.has(currentDevice)) return `${currentDevice}|${landscape ? 'l' : 'p'}`;
        return currentDevice;
    };

    const renderDevice = () => {
        deviceBtns.forEach(b => {
            const isSelected = b.dataset.device === currentDevice;
            b.classList.toggle('btn-secondary', isSelected);
            b.classList.toggle('btn-outline-secondary', !isSelected);
        });

        // Otočit jde mobil, tablet, vlastní zařízení a vlastní rozměr; Fluid, laptop a desktop ne
        const canRotate = hasOrientation(currentDevice) || currentDevice === 'custom';
        rotateBtn.disabled = !canRotate;
        const isLandscape = hasOrientation(currentDevice)
            ? landscape
            : currentDevice === 'custom' && customSize.width > customSize.height;
        rotateBtn.classList.toggle('btn-secondary', canRotate && isLandscape);
        rotateBtn.classList.toggle('btn-outline-secondary', !(canRotate && isLandscape));
        rotateBtn.setAttribute('aria-pressed', String(canRotate && isLandscape));

        customSizeEl.hidden = currentDevice !== 'custom';

        applyDeviceSize();
        mockup.setAttribute('data-device', getMockupKey());
        setTimeout(updateScale, 50);
    };

    const selectDevice = (device, save = true) => {
        currentDevice = device;
        renderDevice();
        if (save) storage.set(DEVICE_STORAGE_KEY, getStoredDeviceKey());
    };

    const rotate = () => {
        if (rotateBtn.disabled) return;
        if (currentDevice === 'custom') {
            customSize = { width: customSize.height, height: customSize.width };
            storage.set('custom-size', `${customSize.width}x${customSize.height}`);
            applyCustomSize();
        } else {
            landscape = !landscape;
        }
        selectDevice(currentDevice);
    };

    deviceBtns.forEach((btn, index) => {
        addShortcutToTitle(btn, SHORTCUTS.device(index + 1));
        btn.addEventListener('click', () => selectDevice(btn.dataset.device));
    });
    addShortcutToTitle(rotateBtn, SHORTCUTS.rotate);
    addShortcutToTitle(scaleBtn, SHORTCUTS.zoom);
    addShortcutToTitle(panel.querySelector('.display-type-btn'), SHORTCUTS.displayType);
    rotateBtn.addEventListener('click', rotate);

    // Výběr zařízení při otevření: zapamatované uživatelem → výchozí z nastavení typu
    // → Laptop → první zobrazené. Použije se jen zařízení, jehož tlačítko v toolbaru existuje
    // (správce mohl zařízení skrýt nebo vlastní zařízení přejmenovat).
    const hasDeviceButton = (device) => !!device && deviceBtns.some(b => b.dataset.device === device);

    const parseStoredDevice = (value) => {
        if (!value) return { device: null, landscape: false };
        const builtIn = /^(mobile|tablet)-(p|l)$/.exec(value);
        if (builtIn) return { device: builtIn[1], landscape: builtIn[2] === 'l' };
        if (value.startsWith(PRESET_PREFIX)) {
            // Název smí obsahovat „|“ – orientace je za posledním
            const separator = value.lastIndexOf('|');
            return separator > 0
                ? { device: value.slice(0, separator), landscape: value.slice(separator + 1) === 'l' }
                : { device: value, landscape: false };
        }
        return { device: value, landscape: false };
    };

    applyCustomSize();
    const saved = parseStoredDevice(storage.get(DEVICE_STORAGE_KEY));
    if (hasDeviceButton(saved.device)) {
        landscape = saved.landscape;
        selectDevice(saved.device, false);
    } else {
        const fallback = [settings.defaultDevice, DEFAULT_DEVICE].find(hasDeviceButton)
            || deviceBtns[0]?.dataset.device
            || DEFAULT_DEVICE;
        selectDevice(fallback, false);
    }

    // --- DISPLAY TYPE (Detail / Summary) ---
    // Summary = jak položka vypadá ve výpisu (karta článku na blogu apod.).
    // Server povolí jen Detail a Summary. Volba se pamatuje pro každý typ obsahu.
    const DISPLAY_STORAGE_KEY = `display:${serverContentType || '*'}`;
    const displayTypeBtn = panel.querySelector('.display-type-btn');
    const displayTypeLabel = displayTypeBtn.querySelector('.pv-lp-display-label');
    const displayTypeIcon = displayTypeBtn.querySelector('i');
    let displayType = storage.get(DISPLAY_STORAGE_KEY) === 'Summary' ? 'Summary' : 'Detail';

    const renderDisplayTypeBtn = () => {
        const isSummary = displayType === 'Summary';
        displayTypeLabel.textContent = isSummary
            ? (translations.displaySummary || 'Summary')
            : (translations.displayDetail || 'Detail');
        displayTypeIcon.className = `fas ${isSummary ? 'fa-th-list' : 'fa-file-alt'} me-1`;
        displayTypeBtn.classList.toggle('btn-secondary', isSummary);
        displayTypeBtn.classList.toggle('btn-outline-secondary', !isSummary);
        displayTypeBtn.setAttribute('aria-pressed', String(isSummary));
    };
    renderDisplayTypeBtn();

    const toggleDisplayType = () => {
        displayType = displayType === 'Summary' ? 'Detail' : 'Summary';
        storage.set(DISPLAY_STORAGE_KEY, displayType);
        renderDisplayTypeBtn();
        // Výslovná volba uživatele – obnoví se hned, i v ručním režimu
        if (currentState !== 'hidden') {
            clearTimeout(timeout);
            updatePreview();
            setPendingChanges(false);
        }
    };
    displayTypeBtn.addEventListener('click', toggleDisplayType);

    // --- DATA BINDING ---
    let timeout = null;

    // Rozpracovaný požadavek – při novém se zruší, aby starší odpověď
    // nemohla přepsat novější (odpovědi mohou dorazit v jiném pořadí)
    let activeRequest = null;

    // --- AUTOMATICKÝ POSUN NA ZMĚNĚNÉ MÍSTO ---
    // Po každé aktualizaci se porovná zdrojové HTML staré a nové verze, náhled se posune
    // k prvnímu změněnému prvku a ten se krátce zvýrazní. Vypíná se tlačítkem v toolbaru.
    const autoScrollBtn = panel.querySelector('.auto-scroll-btn');

    // Výchozí stav je zapnuto
    let autoScroll = storage.get('auto-scroll') !== '0';

    const renderAutoScrollBtn = () => {
        autoScrollBtn.classList.toggle('btn-secondary', autoScroll);
        autoScrollBtn.classList.toggle('btn-outline-secondary', !autoScroll);
        autoScrollBtn.setAttribute('aria-pressed', String(autoScroll));
    };
    renderAutoScrollBtn();

    autoScrollBtn.addEventListener('click', () => {
        autoScroll = !autoScroll;
        renderAutoScrollBtn();
        storage.set('auto-scroll', autoScroll ? '1' : '0');
    });

    // Porovnává se zdrojové HTML (DOMParser – skripty se nespustí), ne živý DOM v iframech:
    // skripty tématu DOM mění nedeterministicky (slidery, náhodná id, lazy-load)
    // a každá aktualizace by pak vypadala jako změna.
    // Přeskakují se uzly, které nejsou vidět nebo se mění při každém vykreslení
    // (antiforgery token ve formulářích tématu, nonce u skriptů).
    const IGNORED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'LINK', 'META']);
    const IGNORED_ATTRIBUTES = new Set(['nonce']);

    const isComparable = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return node.nodeValue.trim() !== '';
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        if (IGNORED_TAGS.has(node.tagName)) return false;
        if (node.tagName === 'INPUT' && (node.getAttribute('type') || '').toLowerCase() === 'hidden') return false;
        return true;
    };

    const sameAttributes = (a, b) => {
        const names = (el) => [...el.attributes].map(attr => attr.name).filter(n => !IGNORED_ATTRIBUTES.has(n));
        const aNames = names(a);
        return aNames.length === names(b).length && aNames.every(n => a.getAttribute(n) === b.getAttribute(n));
    };

    // Nejhlubší element nového dokumentu, ve kterém je první změna; null = beze změny
    const findFirstChange = (oldEl, newEl) => {
        const oldNodes = [...oldEl.childNodes].filter(isComparable);
        const newNodes = [...newEl.childNodes].filter(isComparable);
        const count = Math.max(oldNodes.length, newNodes.length);

        for (let i = 0; i < count; i++) {
            const a = oldNodes[i];
            const b = newNodes[i];

            if (!b) return newEl; // obsah na konci ubyl
            if (!a) return b.nodeType === Node.ELEMENT_NODE ? b : newEl; // obsah přibyl
            if (a.isEqualNode(b)) continue;

            if (a.nodeType === Node.TEXT_NODE || b.nodeType === Node.TEXT_NODE) {
                // Rozdíl jen v bílých znacích není změna
                if (a.nodeType === b.nodeType && a.nodeValue.trim() === b.nodeValue.trim()) continue;
                return b.nodeType === Node.ELEMENT_NODE ? b : newEl;
            }
            if (a.tagName !== b.tagName || !sameAttributes(a, b)) return b;

            // Rozdíl může být jen v ignorovaných uzlech uvnitř – pak hledáme dál
            const inner = findFirstChange(a, b);
            if (inner) return inner;
        }
        return null;
    };

    // Cesta k elementu: od nejbližšího předka s id (nebo od body) přes pořadí mezi
    // sourozenci se stejným tagem. Pořadí podle tagu je odolnější vůči prvkům,
    // které skripty tématu vloží mezi sourozence jiného typu.
    const getLocator = (el) => {
        const steps = [];
        let node = el;
        while (node && node.tagName !== 'BODY') {
            if (node.id) return { id: node.id, steps };
            const parent = node.parentElement;
            if (!parent) break;
            const sameTag = [...parent.children].filter(c => c.tagName === node.tagName);
            steps.unshift({ tag: node.tagName, index: sameTag.indexOf(node) });
            node = parent;
        }
        return { id: null, steps };
    };

    // Najde odpovídající element v živém dokumentu. Pokud skripty strukturu změnily,
    // skončí u nejhlubšího předka, kterého ještě najít jde.
    const resolveLocator = (doc, { id, steps }) => {
        let node = id ? doc.getElementById(id) : doc.body;
        if (!node) return null;
        for (const step of steps) {
            const next = [...node.children].filter(c => c.tagName === step.tag)[step.index];
            if (!next) break;
            node = next;
        }
        // Skrytý prvek (display: none) nemá rozměry – zvýrazní se nejbližší viditelný předek
        while (node && node !== doc.body && node.getClientRects().length === 0) {
            node = node.parentElement;
        }
        return node && node !== doc.body ? node : null;
    };

    // Rozparsovaný dokument poslední verze – při další aktualizaci je to „stará“ verze
    let parsedCache = { html: null, doc: null };
    const parseHtml = (html) => {
        if (parsedCache.html === html) return parsedCache.doc;
        return new DOMParser().parseFromString(html, 'text/html');
    };

    // Zvýraznění: samostatný rámeček nad prvkem, ne úprava stylů prvku samotného
    // (outline by mohl oříznout overflow: hidden předka a téma by ho mohlo přebít).
    // Styly přes CSSOM (element.style) projdou i při CSP bez 'unsafe-inline'.
    const highlightElement = (win, rect) => {
        const doc = win.document;
        const PAD = 4;
        const docWidth = doc.documentElement.clientWidth;
        const left = Math.max(0, rect.left + win.scrollX - PAD);
        const right = Math.min(docWidth + win.scrollX, rect.right + win.scrollX + PAD);

        const box = doc.createElement('div');
        box.setAttribute('aria-hidden', 'true');
        Object.assign(box.style, {
            position: 'absolute',
            left: `${left}px`,
            top: `${rect.top + win.scrollY - PAD}px`,
            width: `${Math.max(0, right - left)}px`,
            height: `${rect.height + PAD * 2}px`,
            margin: '0',
            boxSizing: 'border-box',
            border: '3px solid #0d6efd',
            borderRadius: '6px',
            background: 'rgba(13, 110, 253, 0.08)',
            pointerEvents: 'none',
            zIndex: '2147483647'
        });
        // Do <html>, ne do <body> – body může mít position: relative nebo okraje,
        // které by posunuly souřadnice absolutně umístěného rámečku
        doc.documentElement.appendChild(box);

        const DURATION = 2000;
        const animation = box.animate?.(
            [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }],
            { duration: DURATION, easing: 'ease-out' });
        if (animation) {
            animation.onfinish = () => box.remove();
        } else {
            setTimeout(() => box.remove(), DURATION);
        }
    };

    const revealChange = (oldHtml, newHtml, frame) => {
        try {
            const oldDoc = parseHtml(oldHtml);
            const newDoc = parseHtml(newHtml);
            parsedCache = { html: newHtml, doc: newDoc };

            const changed = findFirstChange(oldDoc.body, newDoc.body);
            if (!changed || changed === newDoc.body) return;

            const win = frame.contentWindow;
            const target = resolveLocator(win.document, getLocator(changed));
            if (!target) return;

            const rect = target.getBoundingClientRect();
            const viewHeight = win.innerHeight;
            const fullyVisible = rect.top >= 0 && rect.bottom <= viewHeight;
            const coversViewport = rect.top <= 0 && rect.bottom >= viewHeight;

            if (!fullyVisible && !coversViewport) {
                // Menší prvek doprostřed, vyšší než viewport horní hranou kousek pod okraj.
                // scrollTo okna iframu, ne scrollIntoView – to by posouvalo i stránku administrace.
                const MARGIN = 20;
                const top = rect.height <= viewHeight - MARGIN * 2
                    ? win.scrollY + rect.top - (viewHeight - rect.height) / 2
                    : win.scrollY + rect.top - MARGIN;
                const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                win.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'instant' : 'smooth' });
            }

            highlightElement(win, rect);
        } catch (e) {
            // Posun je jen pomůcka – chyba nesmí rozbít samotný náhled
            console.warn('PV.LivePreview: unable to locate the changed element:', e);
        }
    };

    // --- AKTUALIZACE BEZ BLIKNUTÍ (DVA IFRAMY) ---
    // Nové HTML se načte do skrytého iframu. Teprve po jeho 'load' (dokument včetně
    // obrázků a stylů je hotový) se do něj přenese scroll z viditelného iframu
    // a iframy si prohodí role. Uživatel tak nikdy nevidí prázdný bílý dokument.
    //
    // pendingFrame = skrytý iframe, do kterého se právě načítá nová verze.
    // Při rychlém psaní může přijít další HTML dřív, než se předchozí načte –
    // src iframu se pak jen přepíše a load dorazí až pro poslední verzi.
    let pendingFrame = null;

    // Zdrojové HTML zobrazené verze a verze, která se načítá (pro hledání změn)
    let activeHtml = null;
    let pendingHtml = null;
    // Validační chyby načítané verze – zobrazí se až s ní, aby odpovídaly tomu, co je vidět
    let pendingErrors = null;
    // Měření načítané verze pro informační lištu: { serverMs, loadStartedAt }
    let pendingTiming = null;
    // Display type zobrazené a načítané verze – při jeho změně nemá smysl hledat změněné místo
    let activeDisplayType = null;
    let pendingDisplayType = null;

    const readScroll = (frame) => {
        try {
            const win = frame.contentWindow;
            const root = win.document.documentElement;
            return { x: win.scrollX || root.scrollLeft || 0, y: win.scrollY || root.scrollTop || 0 };
        } catch (e) {
            return { x: 0, y: 0 };
        }
    };

    const swapFrames = () => {
        // Scroll se čte až teď (ne při odeslání požadavku) – uživatel mohl mezitím
        // náhledem posouvat. 'instant' obchází případné scroll-behavior: smooth tématu.
        const { x, y } = readScroll(activeFrame);
        try { backFrame.contentWindow.scrollTo({ left: x, top: y, behavior: 'instant' }); } catch (e) {}

        backFrame.classList.add('is-active');
        backFrame.removeAttribute('aria-hidden');
        backFrame.removeAttribute('tabindex');

        activeFrame.classList.remove('is-active');
        activeFrame.setAttribute('aria-hidden', 'true');
        activeFrame.setAttribute('tabindex', '-1');

        [activeFrame, backFrame] = [backFrame, activeFrame];

        // Stará verze by ve skrytém iframu dál běžela (časovače, slidery, video se zvukem)
        // a držela paměť – vyprázdníme ji. Její 'load' se ignoruje (pendingFrame je null).
        clearFrame(backFrame);

        const previousHtml = activeHtml;
        activeHtml = pendingHtml;
        pendingHtml = null;

        const displayTypeChanged = activeDisplayType !== null && activeDisplayType !== pendingDisplayType;
        activeDisplayType = pendingDisplayType;
        pendingDisplayType = null;

        showValidationErrors(pendingErrors);
        if (pendingTiming) {
            renderInfoTiming({
                serverMs: pendingTiming.serverMs,
                loadMs: performance.now() - pendingTiming.loadStartedAt,
                culture: pendingTiming.culture
            });
            pendingTiming = null;
        }
        pendingErrors = null;

        // U první verze není s čím porovnávat
        // Detail a Summary jsou jiné stránky – jejich porovnání by „změnu“ našlo všude
        if (autoScroll && !displayTypeChanged && previousHtml != null && activeHtml != null) {
            revealChange(previousHtml, activeHtml, activeFrame);
        }

        // Stavovou zprávu „Načítání“ skryjeme jen tehdy, když už neběží další požadavek.
        // Chybu (is-error) z novějšího požadavku nepřepisujeme.
        if (!activeRequest && statusEl.classList.contains('is-loading')) {
            setStatus(null);
        }
    };

    // Iframe bez obsahu (about:blank) – zastaví skripty a uvolní paměť staré verze
    const clearFrame = (frame) => {
        frame.src = 'about:blank';
    };

    // Prohození po načtení nové verze. Pro iframy panelu i samostatného okna.
    const attachSwapListener = (frame) => frame.addEventListener('load', () => {
        // Load ignorujeme u viditelného iframu, u about:blank i u iframu jiné plochy
        // (panel ↔ okno) – pendingFrame je vždy skrytý iframe aktuální plochy
        if (frame !== pendingFrame || frame !== backFrame) return;
        pendingFrame = null;
        swapFrames();
    });
    [activeFrame, backFrame].forEach(attachSwapListener);

    const renderHtml = (html, errors, serverMs, renderedDisplayType, culture, frameToken) => {
        pendingTiming = { serverMs, loadStartedAt: performance.now(), culture };
        pendingDisplayType = renderedDisplayType;
        pendingFrame = backFrame;
        pendingHtml = html;
        pendingErrors = errors;
        // Stránka se načte z URL (server ji uložil pod tokenem), ne přes srcdoc:
        // dokument ze srcdoc by zdědil CSP administrace a ta by při zapnutém CSP zablokovala
        // inline skripty a styly tématu (bod 10 code review). Každé načtení vytvoří nový
        // dokument i window, takže skripty tématu nenarazí na už deklarované proměnné.
        backFrame.src = frameEndpoint + encodeURIComponent(frameToken);
    };

    // WYSIWYG editory (TinyMCE, Trumbowyg, Monaco, EasyMDE…) zapisují do skrytého
    // textarea programově, takže nevyvolají událost 'input' ani 'change'.
    // TinyMCE navíc do textarea zapíše až po triggerSave().
    const syncEditors = () => {
        try { window.tinymce?.triggerSave(); } catch (e) {}
    };

    // Otisk aktuálních dat formuláře – slouží k detekci změn, o kterých nás nikdo neinformoval.
    const getFormSignature = () => {
        syncEditors();
        const parts = [];
        for (const [key, value] of new FormData(form)) {
            if (key === '__RequestVerificationToken') continue;
            parts.push(key + '=' + (typeof value === 'string' ? value : `[file:${value.name}:${value.size}]`));
        }
        return parts.join('&');
    };

    // Otisk dat, která byla naposledy odeslána do náhledu
    let lastSignature = null;

    // Chyba se zachytí jako objekt se zprávou určenou uživateli
    class PreviewError extends Error {}

    const readErrorResponse = async (response) => {
        if (response.status === 401) {
            return new PreviewError(translations.sessionExpired || 'Your session has expired. Reload the page and sign in again.');
        }
        if (response.status === 403) {
            return new PreviewError(translations.accessDenied || 'You do not have permission to preview this content.');
        }

        const generic = translations.errorOccurred || 'An error occurred while loading the preview.';

        // 400 nese lokalizovaný text ze serveru (prostý text); ostatní chyby jen s kódem
        if (response.status === 400) {
            const contentTypeHeader = response.headers.get('Content-Type') || '';
            if (contentTypeHeader.startsWith('text/plain')) {
                const text = (await response.text()).trim();
                if (text && text.length < 300) return new PreviewError(`${generic} ${text}`);
            }
        }
        return new PreviewError(`${generic} (HTTP ${response.status})`);
    };

    // Výchozí zpoždění je z nastavení typu obsahu (UPDATE_DELAY)
    const scheduleUpdate = (delay = UPDATE_DELAY) => {
        clearTimeout(timeout);
        timeout = setTimeout(updatePreview, delay);
    };

    const updatePreview = () => {
        // Skrytý náhled se neaktualizuje; změny zachytí kontrola otisku po jeho zobrazení
        if (currentState === 'hidden') return;

        lastSignature = getFormSignature();

        const formData = new FormData(form);
        const token = form.querySelector('input[name="__RequestVerificationToken"]')?.value;

        if (serverContentType) {
            formData.set('contentType', serverContentType);
        }

        // Vlastní název pole, aby nekolidoval s poli editačního formuláře OC
        if (serverContentItemId) {
            formData.set('pvLivePreviewContentItemId', serverContentItemId);
        }

        // Display type (Detail / Summary) – server ho ověří proti povolenému seznamu
        const requestDisplayType = displayType;
        formData.set('pvLivePreviewDisplayType', requestDisplayType);

        activeRequest?.abort();
        const request = new AbortController();
        const requestStartedAt = performance.now();
        activeRequest = request;

        setStatus('loading', translations.loading || 'Loading preview...');

        fetch(renderEndpoint, {
            method: 'POST',
            body: formData,
            headers: { 'RequestVerificationToken': token },
            signal: request.signal
        })
        .then(async response => {
            // Po vypršení session OC přesměruje na přihlášení; fetch přesměrování
            // následuje a vrátí přihlašovací stránku s kódem 200 – tu nezobrazujeme.
            if (response.redirected) {
                throw new PreviewError(translations.sessionExpired || 'Your session has expired. Reload the page and sign in again.');
            }
            if (!response.ok) {
                throw await readErrorResponse(response);
            }
            const html = await response.text();
            return {
                html,
                errors: readValidationErrors(response),
                // Až po přečtení celého těla – server posílá HTML průběžně, jak ho vykresluje
                serverMs: performance.now() - requestStartedAt,
                // Kultura, ve které server náhled vykreslil (jen u položek s LocalizationPart)
                culture: response.headers.get('X-PV-LivePreview-Culture'),
                // Token, pod kterým server stránku uložil pro načtení iframem (frame/{token})
                frameToken: response.headers.get('X-PV-LivePreview-Frame')
            };
        })
        .then(({ html, errors, serverMs, culture, frameToken }) => {
            if (activeRequest !== request) return;
            if (!frameToken) {
                throw new PreviewError(translations.errorOccurred || 'An error occurred while loading the preview.');
            }

            // Stav „Načítání“ zůstává, dokud se nová verze nenačte a neprohodí (swapFrames)
            renderHtml(html, errors, serverMs, requestDisplayType, culture, frameToken);
        })
        .catch(err => {
            // Zrušený požadavek není chyba – nahradil ho novější
            if (err.name === 'AbortError' || activeRequest !== request) return;

            console.error('PV.LivePreview:', err);
            setStatus('error', err instanceof PreviewError
                ? err.message
                : (translations.errorOccurred || 'An error occurred while loading the preview.'));
        })
        .finally(() => {
            if (activeRequest === request) activeRequest = null;
        });
    };

    // --- REŽIM AKTUALIZACE (Auto / Ručně) ---
    // V ručním režimu se náhled obnovuje jen tlačítkem. Hodí se u náročných stránek
    // (každé vykreslení zatěžuje server) a při psaní dlouhých textů.
    const autoUpdateBtn = panel.querySelector('.auto-update-btn');
    const refreshBtn = panel.querySelector('.refresh-btn');
    const refreshTitle = `${translations.refreshTitle || 'Refresh preview'} (${SHORTCUTS.refresh})`;
    const refreshPendingTitle = `${translations.refreshPendingTitle || 'Refresh preview – there are changes not shown yet'} (${SHORTCUTS.refresh})`;
    refreshBtn.title = refreshTitle;

    // Výchozí stav je Auto
    let autoUpdate = storage.get('auto-update') !== '0';

    const renderAutoUpdateBtn = () => {
        autoUpdateBtn.classList.toggle('btn-secondary', autoUpdate);
        autoUpdateBtn.classList.toggle('btn-outline-secondary', !autoUpdate);
        autoUpdateBtn.setAttribute('aria-pressed', String(autoUpdate));
    };

    // Ruční režim: tlačítko Obnovit zežloutne, když formulář obsahuje změny, které náhled neukazuje
    let hasPendingChanges = false;
    const setPendingChanges = (pending) => {
        pending = pending && !autoUpdate;
        if (pending === hasPendingChanges) return;
        hasPendingChanges = pending;
        refreshBtn.classList.toggle('btn-warning', pending);
        refreshBtn.classList.toggle('btn-outline-secondary', !pending);
        refreshBtn.title = pending ? refreshPendingTitle : refreshTitle;
    };

    renderAutoUpdateBtn();

    autoUpdateBtn.addEventListener('click', () => {
        autoUpdate = !autoUpdate;
        renderAutoUpdateBtn();
        storage.set('auto-update', autoUpdate ? '1' : '0');
        // Po zapnutí Auto se hned ukážou změny nastřádané v ručním režimu
        if (autoUpdate && getFormSignature() !== lastSignature) scheduleUpdate(0);
        setPendingChanges(false);
    });

    refreshBtn.addEventListener('click', () => {
        // Obnovit jde i v režimu Auto (např. po změně šablony tématu na serveru)
        clearTimeout(timeout);
        updatePreview();
        setPendingChanges(false);
    });

    // Běžná pole formuláře hlásí změny událostmi (v ručním režimu je zachytí kontrola otisku)
    const onFormChanged = () => {
        if (autoUpdate) scheduleUpdate();
    };
    form.addEventListener('input', onFormChanged);
    form.addEventListener('change', onFormChanged);

    // Záchytná síť pro editory, které události nevyvolávají: jednou za sekundu
    // porovnáme otisk dat formuláře s naposledy odeslaným a při rozdílu náhled obnovíme
    // (v ručním režimu jen označíme tlačítko Obnovit).
    setInterval(() => {
        if (currentState === 'hidden') return;
        const changed = getFormSignature() !== lastSignature;
        if (autoUpdate) {
            if (changed) scheduleUpdate();
        } else {
            setPendingChanges(changed);
        }
    }, 1000);

    // --- SAMOSTATNÉ OKNO (bod 4 roadmapy) ---
    // Okno (api/pv-live-preview/window) má stejný origin, takže ho editor řídí přímo:
    // po jeho připojení se iframy, stavová zpráva, validační pruh a upozornění „přepnou“
    // na prvky okna a vykreslování (přepínání bez bliknutí, posun na změny, chyby…)
    // funguje beze změny. Viewport náhledu = velikost okna. Panel se mezitím sbalí do lišty.
    const WINDOW_READY_EVENT = 'pv-live-preview-window-ready';
    const WINDOW_CLOSED_EVENT = 'pv-live-preview-window-closed';
    const detachBtn = panel.querySelector('.detach-btn');

    // Prvky panelu – po zavření okna se na ně plocha vrátí
    const panelSurface = {
        frames: [...panel.querySelectorAll('.pv-live-preview-iframe')],
        status: statusEl,
        validation: validationEl,
        notice: noticeEl,
    };

    let previewWindow = null;
    let stateBeforeDetach = 'split';
    let windowWatchTimer = null;

    // Přepne vykreslování na zadanou plochu (iframy + prvky stavů)
    const useSurface = ({ frames, status, validation, notice }) => {
        // Rozpracované načítání patří staré ploše – jeho load se ignoruje
        pendingFrame = null;
        // Nová plocha zatím nic neukazuje: bez porovnání se starou verzí (posun na změny)
        activeHtml = null;
        activeDisplayType = null;
        shownErrorsKey = null;

        const active = frames.find(f => f.classList.contains('is-active')) || frames[0];
        activeFrame = active;
        backFrame = frames.find(f => f !== active);
        statusEl = status;
        validationEl = validation;
        noticeEl = notice;
    };

    const focusWindow = () => {
        try { previewWindow?.focus(); } catch (e) {}
    };

    // Okno je připravené (událost z pv-live-preview-window.js) – převezmeme jeho plochu
    const mountWindow = (win) => {
        const doc = win.document;
        const frames = [...doc.querySelectorAll('.pv-live-preview-iframe')];
        if (frames.length !== 2) return;

        frames.forEach(frame => {
            attachPreviewDocumentListeners(frame);
            attachSwapListener(frame);
        });
        // Zkratky i s fokusem v okně mimo iframe (např. na validačním pruhu)
        doc.addEventListener('keydown', onKeyDown);
        doc.body.classList.add('is-connected');
        if (serverContentType) doc.title = `${doc.title} – ${serverContentType}`;

        useSurface({
            frames,
            status: doc.querySelector('.pv-live-preview-status'),
            validation: doc.querySelector('.pv-live-preview-validation'),
            notice: doc.querySelector('.pv-live-preview-notice'),
        });

        // Vykreslit hned – i v ručním režimu (otevření okna je výslovná volba)
        clearTimeout(timeout);
        updatePreview();
        setPendingChanges(false);
    };

    // Návrat náhledu do panelu (zavřené okno, tlačítko v liště, zkratka)
    const attachToPanel = () => {
        clearInterval(windowWatchTimer);
        windowWatchTimer = null;
        const win = previewWindow;
        previewWindow = null;
        try { if (win && !win.closed) win.close(); } catch (e) {}

        if (currentState !== 'detached') return;
        useSurface(panelSurface);
        updateState(stateBeforeDetach, false);
        clearTimeout(timeout);
        updatePreview();
        setPendingChanges(false);
    };

    const openWindow = () => {
        if (previewWindow && !previewWindow.closed) {
            focusWindow();
            return;
        }

        // Pojmenované okno – druhé otevření stejné položky použije stejné okno
        const name = `pv-live-preview-${(serverContentItemId || serverContentType || 'new').replace(/[^\w-]/g, '')}`;
        const win = window.open(windowEndpoint, name, 'popup=yes,width=1280,height=800');
        if (!win) {
            showNotice(translations.windowBlocked || 'The browser blocked the new window. Allow pop-up windows for this site.');
            return;
        }

        previewWindow = win;
        if (currentState !== 'detached') stateBeforeDetach = currentState === 'fullscreen' ? 'fullscreen' : 'split';
        // Panel se schová; jeho iframy vyprázdníme, ať v nich téma zbytečně neběží
        updateState('detached', false);
        panelSurface.frames.forEach(clearFrame);

        // Pojistka: okno zavřené tak, že pagehide nedorazil (pád prohlížeče apod.)
        clearInterval(windowWatchTimer);
        windowWatchTimer = setInterval(() => {
            if (!previewWindow || previewWindow.closed) attachToPanel();
        }, 1000);
    };

    const toggleWindow = () => {
        if (currentState === 'detached') {
            attachToPanel();
        } else {
            openWindow();
        }
    };

    window.addEventListener(WINDOW_READY_EVENT, (e) => {
        // Více editorů na stránce – reagujeme jen na vlastní okno
        if (e.detail?.window === previewWindow) mountWindow(previewWindow);
    });
    window.addEventListener(WINDOW_CLOSED_EVENT, (e) => {
        if (e.detail?.window !== previewWindow) return;
        // pagehide přijde i při obnovení okna (F5) – pak okno zůstane otevřené a po načtení
        // znovu pošle READY. Zavřené okno poznáme až po chvíli.
        setTimeout(() => {
            if (!previewWindow || previewWindow.closed) attachToPanel();
        }, 300);
    });

    // Odchod z editoru (uložení, navigace) – okno bez editoru nemá smysl
    window.addEventListener('pagehide', () => {
        try { previewWindow?.close(); } catch (e) {}
    });

    detachBtn.addEventListener('click', openWindow);
    detachedBar.querySelector('.pv-lp-focus-window').addEventListener('click', focusWindow);
    detachedBar.querySelector('.pv-lp-attach').addEventListener('click', attachToPanel);
    // Obnovit (ruční režim) – tlačítko v toolbaru je ve sbaleném panelu
    detachedBar.querySelector('.pv-lp-window-refresh').addEventListener('click', () => refreshBtn.click());

    // Obnovení uloženého stavu (skrytý / celá obrazovka). Až na konci inicializace –
    // updateState potřebuje updateScale a ve skrytém stavu se první vykreslení
    // odloží do zobrazení náhledu.
    // Nastavení typu „skrytý při otevření“ má přednost (náročné vykreslení).
    if (settings.startHidden === true) {
        updateState('hidden', false);
    } else {
        const savedState = storage.get('state');
        if (savedState !== 'split' && STATES.includes(savedState)) {
            updateState(savedState, false);
        }
    }

    scheduleUpdate(250);
}

// Skript se načítá v patičce stránky (at="Foot"), DOM tedy obvykle už existuje.
// Pro jistotu ale počkáme na DOMContentLoaded, pokud se dokument ještě načítá.
const initAll = () => document.querySelectorAll('[data-pv-live-preview]').forEach(initLivePreview);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAll);
} else {
    initAll();
}
})();
