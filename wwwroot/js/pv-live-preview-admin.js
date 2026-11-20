/*
 * PV.LivePreview – stránka hromadného nastavení (Obsah → Definice obsahu → Živý náhled).
 * Registrováno v ResourceManagementOptionsConfiguration jako script "PV.LivePreview.Admin".
 * Výběr všech typů, stav „částečně vybráno“ a počet vybraných typů u tlačítka.
 */
(function () {
'use strict';

const init = () => {
    const form = document.querySelector('form.pv-lp-admin');
    if (!form) return;

    const selectAll = form.querySelector('.pv-lp-select-all');
    const checkboxes = [...form.querySelectorAll('.pv-lp-select')];
    const submitBtn = form.querySelector('.pv-lp-bulk-submit');
    const countEl = form.querySelector('.pv-lp-selected-count');

    // Text „Vybráno: {0}“ je lokalizovaný v Razoru (data atribut), zde jen dosazení čísla
    const countTemplate = countEl?.dataset.template || '{0}';

    const update = () => {
        const selected = checkboxes.filter(c => c.checked).length;
        if (selectAll) {
            selectAll.checked = selected > 0 && selected === checkboxes.length;
            selectAll.indeterminate = selected > 0 && selected < checkboxes.length;
        }
        // Bez výběru nemá akce smysl (server by jen zobrazil upozornění)
        if (submitBtn) submitBtn.disabled = selected === 0;
        if (countEl) countEl.textContent = selected > 0 ? countTemplate.replace('{0}', selected) : '';
    };

    selectAll?.addEventListener('change', () => {
        checkboxes.forEach(c => { c.checked = selectAll.checked; });
        update();
    });
    checkboxes.forEach(c => c.addEventListener('change', update));

    update();
};

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
})();
