using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.Extensions.Localization;
using OrchardCore.ContentManagement;
using OrchardCore.ContentManagement.Display;
using OrchardCore.ContentManagement.Metadata;
using OrchardCore.Contents;
using OrchardCore.DisplayManagement;
using OrchardCore.DisplayManagement.ModelBinding;
using OrchardCore.Localization;
using PV.LivePreview.Models;
using PV.LivePreview.Services;
using Microsoft.Extensions.DependencyInjection;

namespace PV.LivePreview.Controllers;

/// <summary>
/// Kontroler pro renderování živého náhledu z dat editačního formuláře.
/// Vrací vyrenderovanou stránku v aktuálním frontendovém tématu (route není pod /Admin).
/// </summary>
[Route("api/pv-live-preview")]
[Authorize]
public class LivePreviewController(
    IContentManager contentManager,
    IContentDefinitionManager contentDefinitionManager,
    IContentItemDisplayManager contentItemDisplayManager,
    IAuthorizationService authorizationService,
    IUpdateModelAccessor updateModelAccessor,
    IServiceProvider serviceProvider,
    LivePreviewFrameStore frameStore,
    IStringLocalizer<LivePreviewController> S) : Controller
{
    /// <summary>
    /// Přijímá odeslaný editační formulář a vrací vyrenderované HTML.
    /// </summary>
    [HttpPost("render")]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> RenderAsync(
        [FromForm] string? contentType,
        [FromForm(Name = "pvLivePreviewContentItemId")] string? contentItemId,
        [FromForm(Name = "pvLivePreviewDisplayType")] string? displayType)
    {
        // Oprávnění „Use Live Preview“ – nezávislé na EditContent, který se kontroluje níže.
        // StatusCode(403) místo Forbid() – viz komentář u kontroly EditContent.
        if (!await authorizationService.AuthorizeAsync(User, Permissions.UseLivePreview))
        {
            return StatusCode(StatusCodes.Status403Forbidden);
        }

        // Display type jen z bezpečného seznamu – endpoint nesmí vykreslit libovolný shape
        // (např. SummaryAdmin s administrátorskými akcemi v tématu webu)
        displayType = string.IsNullOrEmpty(displayType) ? DefaultDisplayType : displayType;
        if (!AllowedDisplayTypes.Contains(displayType))
        {
            return BadRequest(S["This display type is not allowed in the preview."].Value);
        }

        if (string.IsNullOrEmpty(contentType))
        {
            return BadRequest(S["Unable to determine ContentType from the sent data."].Value);
        }

        // Náhled je povolen jen pro existující typy se zapnutým Live Preview –
        // endpoint tak nejde zneužít k renderování libovolného typu obsahu.
        var contentTypeDefinition = await contentDefinitionManager.GetTypeDefinitionAsync(contentType);
        if (contentTypeDefinition == null
            || contentTypeDefinition.GetSettings<LivePreviewSettings>().Position == LivePreviewPosition.None)
        {
            return BadRequest(S["Live preview is not enabled for this content type."].Value);
        }

        // Transientní (pouze v paměti žijící) instance obsahu. Nikdy se neukládá.
        // Načtenou existující položku záměrně neupravujeme přímo – je sledovaná YesSql
        // session a změny by se mohly nechtěně uložit.
        var contentItem = await contentManager.NewAsync(contentType);
        var isNew = string.IsNullOrEmpty(contentItemId);
        ContentItem? existing = null;

        if (isNew)
        {
            // Nová položka: vlastníkem je aktuální uživatel, stejně jako při vytváření
            // obsahu v OC administraci – projde tak i uživatel s oprávněním „upravovat vlastní obsah“.
            contentItem.Owner = User.FindFirstValue(ClaimTypes.NameIdentifier);
        }
        else
        {
            // Existující položka: převezmeme identitu a metadata uložené verze.
            // Díky stejnému ContentItemId se správně vykreslí části závislé na ID
            // (seznamy, kontejnery, vazby) a validace (např. unikátnost Autoroute)
            // nebude hlásit kolizi sama se sebou.
            existing = await contentManager.GetAsync(contentItemId, VersionOptions.Latest);
            if (existing == null || existing.ContentType != contentType)
            {
                return NotFound();
            }

            contentItem.ContentItemId = existing.ContentItemId;
            contentItem.ContentItemVersionId = existing.ContentItemVersionId;
            contentItem.Owner = existing.Owner;
            contentItem.Author = existing.Author;
            contentItem.CreatedUtc = existing.CreatedUtc;
            contentItem.PublishedUtc = existing.PublishedUtc;
            contentItem.ModifiedUtc = existing.ModifiedUtc;
        }

        // Kdo nesmí položku upravovat, nesmí ani vidět její náhled.
        // U existující položky se oprávnění ověřuje vůči skutečnému vlastníkovi.
        // StatusCode(403) místo Forbid(): Forbid() by u cookie autentizace přesměroval
        // na stránku AccessDenied a fetch by dostal HTML s kódem 200.
        if (!await authorizationService.AuthorizeAsync(User, CommonPermissions.EditContent, contentItem))
        {
            return StatusCode(StatusCodes.Status403Forbidden);
        }

        // Naplnění modelu daty z odeslaného formuláře (stejně jako OC jádro)
        var updateModel = updateModelAccessor.ModelUpdater;
        await contentItemDisplayManager.UpdateEditorAsync(contentItem, updateModel, isNew);

        // Validační chyby (např. obsazená URL v Autoroute) náhled nezastaví – vykreslí se,
        // ale skript nad ním zobrazí upozornění, že obsah v tomto stavu nepůjde uložit.
        AddValidationErrorsHeader(updateModel.ModelState);

        // Kultura položky (LocalizationPart). Zpracování formuláře výše proběhlo v kultuře
        // administrace (validační hlášky v jazyce správce); vykreslení proběhne v kultuře
        // položky, jinak by náhled české stránky mohl ukazovat anglické texty šablon.
        var culture = await ResolvePreviewCultureAsync(existing, contentItem);
        if (culture != null)
        {
            Response.Headers[CultureHeader] = culture;
        }

        // Vyrenderování obsahu pro frontend (Detail nebo Summary – jak položka vypadá ve výpisu)
        IShape model;
        using (culture != null ? CultureScope.Create(culture, culture) : null)
        {
            model = await contentItemDisplayManager.BuildDisplayAsync(contentItem, updateModel, displayType);
        }

        ViewData[DisplayTypeViewDataKey] = displayType;
        ViewResult view = View("Preview", model);

        // Výsledek se vykreslí do bufferu: HTML jde v odpovědi skriptu (porovnání verzí)
        // a zároveň se uloží pro načtení iframem přes URL (hlavička s tokenem).
        return new FrameResult(view, culture, frameStore, GetUserKey());
    }

    /// <summary>
    /// Vykreslený náhled pro iframe. Načítá se přes URL místo srcdoc, takže dokument má
    /// CSP webu a ne CSP administrace (bod 10 code review). Token je vázaný na uživatele.
    /// </summary>
    [HttpGet("frame/{token}")]
    public async Task<IActionResult> FrameAsync(string token)
    {
        if (!await authorizationService.AuthorizeAsync(User, Permissions.UseLivePreview))
        {
            return StatusCode(StatusCodes.Status403Forbidden);
        }

        var html = frameStore.Get(GetUserKey(), token);
        if (html == null)
        {
            // Vypršel (náhledy žijí jen krátce) nebo patří jinému uživateli
            return NotFound();
        }

        Response.Headers.CacheControl = "no-store";
        Response.Headers["X-Robots-Tag"] = "noindex, nofollow";
        return Content(html, "text/html; charset=utf-8");
    }

    /// <summary>
    /// Stránka samostatného okna náhledu (bod 4 roadmapy). Obsahuje jen plochu se dvěma
    /// iframy – vše ostatní řídí skript editoru, který okno otevřel (stejný origin).
    /// </summary>
    [HttpGet("window")]
    public async Task<IActionResult> WindowAsync()
    {
        if (!await authorizationService.AuthorizeAsync(User, Permissions.UseLivePreview))
        {
            return StatusCode(StatusCodes.Status403Forbidden);
        }

        Response.Headers.CacheControl = "no-store";
        return View("Window");
    }

    /// <summary>Hlavička s tokenem vykresleného náhledu (URL frame/{token}).</summary>
    public const string FrameHeader = "X-PV-LivePreview-Frame";

    private string GetUserKey()
        => User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.Identity?.Name ?? string.Empty;

    /// <summary>Hlavička s kulturou, ve které se náhled vykreslil (zobrazí ji informační lišta).</summary>
    public const string CultureHeader = "X-PV-LivePreview-Culture";

    /// <summary>
    /// Kultura, ve které se má náhled vykreslit: kultura uložené verze položky
    /// (formulář editace ji neposílá), u nové položky kultura nastavená při vytvoření.
    /// Null = beze změny (bez LocalizationPart, prázdná nebo web kulturu nepodporuje).
    /// </summary>
    private async Task<string?> ResolvePreviewCultureAsync(ContentItem? existing, ContentItem preview)
    {
        var culture = (existing != null ? GetItemCulture(existing) : null) ?? GetItemCulture(preview);
        if (string.IsNullOrWhiteSpace(culture))
        {
            return null;
        }

        // Jen kultury, které web podporuje. ILocalizationService poskytuje modul Localization –
        // když není zapnutý, kulturu aspoň ověříme jako platnou CultureInfo.
        var localizationService = serviceProvider.GetService<ILocalizationService>();
        if (localizationService != null)
        {
            var supported = await localizationService.GetSupportedCulturesAsync();
            return supported.FirstOrDefault(c => string.Equals(c, culture, StringComparison.OrdinalIgnoreCase));
        }

        try
        {
            return System.Globalization.CultureInfo.GetCultureInfo(culture).Name;
        }
        catch (System.Globalization.CultureNotFoundException)
        {
            return null;
        }
    }

    /// <summary>
    /// Kultura z LocalizationPart čtená přímo z JSON dat položky – modul tak nepotřebuje
    /// závislost na OrchardCore.ContentLocalization (a funguje i bez něj).
    /// </summary>
    private static string? GetItemCulture(ContentItem contentItem)
    {
        try
        {
            // ContentItem.Content je dynamický JSON (JsonDynamicObject); chybějící část = null
            dynamic content = contentItem.Content;
            var culture = content.LocalizationPart?.Culture;
            return culture?.ToString();
        }
        catch (Exception ex) when (ex is Microsoft.CSharp.RuntimeBinder.RuntimeBinderException
            or InvalidOperationException or FormatException)
        {
            // Nečekaný tvar dat – náhled se vykreslí v kultuře administrace
            return null;
        }
    }

    /// <summary>
    /// Spustí vnitřní výsledek (Razor view) – případně v kultuře položky – do bufferu,
    /// uloží HTML do LivePreviewFrameStore, přidá hlavičku s tokenem a HTML odešle.
    /// Razor view se vykresluje až po návratu z akce, kultura nastavená v akci by se
    /// do něj nepřenesla – proto má vlastní CultureScope.
    /// </summary>
    private sealed class FrameResult(IActionResult inner, string? culture, LivePreviewFrameStore store, string userKey) : IActionResult
    {
        public async Task ExecuteResultAsync(ActionContext context)
        {
            var response = context.HttpContext.Response;
            var originalBody = response.Body;
            await using var buffer = new MemoryStream();

            using (culture != null ? CultureScope.Create(culture, culture) : null)
            {
                response.Body = buffer;
                try
                {
                    await inner.ExecuteResultAsync(context);
                }
                finally
                {
                    response.Body = originalBody;
                }
            }

            // ViewResult píše UTF-8 (text/html; charset=utf-8)
            var html = System.Text.Encoding.UTF8.GetString(buffer.GetBuffer(), 0, (int)buffer.Length);
            response.Headers[FrameHeader] = store.Store(userKey, html);

            buffer.Position = 0;
            await buffer.CopyToAsync(originalBody, context.HttpContext.RequestAborted);
        }
    }

    private const string DefaultDisplayType = "Detail";

    /// <summary>Display typy, které smí náhled vykreslit.</summary>
    private static readonly HashSet<string> AllowedDisplayTypes = new(StringComparer.Ordinal) { "Detail", "Summary" };

    /// <summary>Klíč ViewData s display typem pro view Preview.</summary>
    public const string DisplayTypeViewDataKey = "PvLivePreviewDisplayType";

    /// <summary>Hlavička s validačními chybami pro skript náhledu.</summary>
    public const string ValidationErrorsHeader = "X-PV-LivePreview-Errors";

    // Limity drží velikost hlavičky daleko pod limity serverů a proxy (typicky 8 kB)
    private const int MaxValidationErrors = 10;
    private const int MaxValidationErrorLength = 200;

    /// <summary>
    /// Přidá do odpovědi chybové zprávy z ModelState jako JSON pole řetězců.
    /// Hlavičky HTTP smí obsahovat jen ASCII, proto je JSON zakódovaný přes
    /// Uri.EscapeDataString (v JS se dekóduje decodeURIComponent).
    /// </summary>
    private void AddValidationErrorsHeader(ModelStateDictionary modelState)
    {
        if (modelState.IsValid)
        {
            return;
        }

        var messages = modelState.Values
            .SelectMany(entry => entry.Errors)
            // Chyby bez textu nesou jen výjimku – její zprávu uživateli neukazujeme
            .Select(error => error.ErrorMessage?.Trim())
            .Where(message => !string.IsNullOrEmpty(message))
            .Select(message => message!.Length > MaxValidationErrorLength
                ? string.Concat(message.AsSpan(0, MaxValidationErrorLength), "…")
                : message!)
            .Distinct()
            .Take(MaxValidationErrors)
            .ToList();

        // Neplatný stav bez čitelné zprávy – skript zobrazí obecný text
        Response.Headers[ValidationErrorsHeader] = Uri.EscapeDataString(JsonSerializer.Serialize(messages));
    }
}
