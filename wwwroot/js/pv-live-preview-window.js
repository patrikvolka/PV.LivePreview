/*
 * PV.LivePreview – samostatné okno náhledu (bod 4 roadmapy).
 * Registrováno v ResourceManagementOptionsConfiguration jako script "PV.LivePreview.Window".
 *
 * Okno samo nic nevykresluje. Po načtení oznámí editoru, který ho otevřel (window.opener,
 * stejný origin), že je připravené – editor si pak převezme jeho iframy a prvky a řídí je
 * stejnou logikou jako panel (přepínání bez bliknutí, posun na změny, chyby…).
 * Při zavření nebo obnovení okna to editoru oznámí, aby se vrátil do panelu.
 */
(function () {
'use strict';

const READY_EVENT = 'pv-live-preview-window-ready';
const CLOSED_EVENT = 'pv-live-preview-window-closed';

const notifyOpener = (type) => {
    try {
        // Okno otevřené z editoru: událost na window editoru (stejný origin), v detailu toto okno
        window.opener?.dispatchEvent(new CustomEvent(type, { detail: { window } }));
        return !!window.opener;
    } catch (e) {
        return false;
    }
};

const init = () => {
    if (!notifyOpener(READY_EVENT)) {
        // Otevřeno přímo (záložka, obnovené okno po zavření editoru) – není kdo by ho řídil
        document.querySelector('.pv-lp-window-waiting')?.setAttribute('hidden', '');
        document.querySelector('.pv-lp-window-orphan')?.removeAttribute('hidden');
    }
};

// pagehide – i při obnovení okna (F5); editor se po novém READY znovu připojí
window.addEventListener('pagehide', () => notifyOpener(CLOSED_EVENT));

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
})();
