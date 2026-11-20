using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using OrchardCore.ContentManagement;
using OrchardCore.ContentManagement.Display.ContentDisplay;
using OrchardCore.ContentManagement.Metadata;
using OrchardCore.DisplayManagement.Handlers;
using OrchardCore.DisplayManagement.Views;
using PV.LivePreview.Models;
using PV.LivePreview.ViewModels;

namespace PV.LivePreview.Drivers;

/// <summary>
/// Globální driver, který dynamicky přidává Live Preview UI do editační stránky obsahu,
/// jehož typ má v nastavení zapnutou pozici náhledu.
/// </summary>
public class LivePreviewContentDisplayDriver(
    IContentDefinitionManager contentDefinitionManager,
    IAuthorizationService authorizationService,
    IHttpContextAccessor httpContextAccessor) : ContentDisplayDriver
{
    public override async Task<IDisplayResult?> EditAsync(ContentItem contentItem, BuildEditorContext context)
    {
        // Vnořené položky (BagPart, FlowPart, widgety…) mají neprázdný HtmlFieldPrefix.
        // Náhled patří jen k editoru hlavní položky, jinak by vzniklo více panelů nad stejným formulářem.
        if (!string.IsNullOrEmpty(context.HtmlFieldPrefix) || string.IsNullOrEmpty(contentItem.ContentType))
        {
            return null;
        }

        // Bez oprávnění „Use Live Preview“ se panel vůbec nevykreslí.
        // Stejnou kontrolu dělá i LivePreviewController – skrytí panelu samo o sobě nestačí.
        var user = httpContextAccessor.HttpContext?.User;
        if (user == null || !await authorizationService.AuthorizeAsync(user, Permissions.UseLivePreview))
        {
            return null;
        }

        var contentTypeDefinition = await contentDefinitionManager.GetTypeDefinitionAsync(contentItem.ContentType);
        if (contentTypeDefinition == null)
        {
            return null;
        }

        // GetSettings vrací vždy instanci (při chybějícím nastavení výchozí s Position = None)
        var settings = contentTypeDefinition.GetSettings<LivePreviewSettings>();
        if (settings.Position == LivePreviewPosition.None)
        {
            return null;
        }

        return Initialize<LivePreviewViewModel>("LivePreviewInjection", model =>
        {
            // Hodnota slouží jako CSS třída (pv-lp-left/right/bottom) – nezávisle na kultuře
            model.Position = settings.Position.ToString().ToLowerInvariant();

            // Při vytváření nové položky (Create) je ContentItemId prázdné
            model.ContentItemId = contentItem.ContentItemId ?? string.Empty;
            model.ContentType = contentItem.ContentType;
            model.Settings = settings;
        }).Location("Content:after");
    }
}
