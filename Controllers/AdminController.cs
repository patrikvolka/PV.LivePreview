using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Localization;
using OrchardCore.Admin;
using OrchardCore.ContentManagement.Metadata;
using OrchardCore.ContentManagement.Metadata.Settings;
using OrchardCore.DisplayManagement.Notify;
using PV.LivePreview.Models;
using PV.LivePreview.ViewModels;

namespace PV.LivePreview.Controllers;

/// <summary>
/// Hromadné nastavení pozice živého náhledu pro více typů obsahu najednou
/// (Obsah → Definice obsahu → Živý náhled).
/// Seznam typů obsahu v OC hromadné akce nepodporuje, proto vlastní stránka.
/// </summary>
[Admin]
public class AdminController(
    IContentDefinitionManager contentDefinitionManager,
    IAuthorizationService authorizationService,
    INotifier notifier,
    IHtmlLocalizer<AdminController> H) : Controller
{
    public async Task<IActionResult> Index()
    {
        if (!await authorizationService.AuthorizeAsync(User, Permissions.EditContentTypes))
        {
            return Forbid();
        }

        var typeDefinitions = await contentDefinitionManager.ListTypeDefinitionsAsync();

        var model = new LivePreviewContentTypesViewModel
        {
            ContentTypes = typeDefinitions
                .Select(type => new LivePreviewContentTypeEntry
                {
                    Name = type.Name,
                    DisplayName = string.IsNullOrWhiteSpace(type.DisplayName) ? type.Name : type.DisplayName,
                    Stereotype = type.GetSettings<ContentTypeSettings>().Stereotype,
                    Position = type.GetSettings<LivePreviewSettings>().Position,
                })
                .OrderBy(type => type.DisplayName, StringComparer.CurrentCultureIgnoreCase)
                .ToList(),
        };

        return View(model);
    }

    [HttpPost]
    [ActionName(nameof(Index))]
    [ValidateAntiForgeryToken]
    public async Task<IActionResult> IndexPost(LivePreviewBulkUpdateModel model)
    {
        if (!await authorizationService.AuthorizeAsync(User, Permissions.EditContentTypes))
        {
            return Forbid();
        }

        if (!Enum.IsDefined(model.Position))
        {
            return BadRequest();
        }

        var selectedTypes = (model.SelectedTypes ?? [])
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Distinct(StringComparer.Ordinal)
            .ToList();

        if (selectedTypes.Count == 0)
        {
            await notifier.WarningAsync(H["Select at least one content type."]);
            return RedirectToAction(nameof(Index));
        }

        var updatedCount = 0;
        foreach (var typeName in selectedTypes)
        {
            // Názvy přicházejí z formuláře – typ mezitím mohl být smazán nebo název podvržen
            var typeDefinition = await contentDefinitionManager.GetTypeDefinitionAsync(typeName);
            if (typeDefinition == null
                || typeDefinition.GetSettings<LivePreviewSettings>().Position == model.Position)
            {
                continue;
            }

            // MergeSettings mění jen Position – případná další nastavení náhledu
            // (rozšíření z bodu 6 roadmapy) zůstanou zachovaná
            await contentDefinitionManager.AlterTypeDefinitionAsync(typeName, type => type
                .MergeSettings<LivePreviewSettings>(settings => settings.Position = model.Position));

            updatedCount++;
        }

        // Formulace bez skloňování podle počtu – čeština má tři tvary množného čísla
        await notifier.SuccessAsync(H["Live preview position has been saved. Number of changed content types: {0}.", updatedCount]);

        return RedirectToAction(nameof(Index));
    }
}
