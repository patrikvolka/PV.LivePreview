// Startup.cs
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using OrchardCore.ContentManagement.Display.ContentDisplay;
using OrchardCore.ContentTypes.Editors;
using OrchardCore.Modules;
using OrchardCore.Navigation;
using OrchardCore.ResourceManagement;
using OrchardCore.Security.Permissions;
using PV.LivePreview.Drivers;
using PV.LivePreview.Services;

namespace PV.LivePreview;

/// <summary>
/// Vstupní bod modulu pro registraci závislostí.
/// </summary>
public class Startup : StartupBase
{
    public override void ConfigureServices(IServiceCollection services)
    {
        // Administrace nastavení pozice pro ContentType
        services.AddScoped<IContentTypeDefinitionDisplayDriver, LivePreviewSettingsDriver>();

        // Injekce samotného UI do editačního formuláře obsahu
        services.AddScoped<IContentDisplayDriver, LivePreviewContentDisplayDriver>();

        // Statické prostředky (CSS a JS z wwwroot)
        services.AddTransient<IConfigureOptions<ResourceManagementOptions>, ResourceManagementOptionsConfiguration>();

        // Oprávnění „Use Live Preview“
        services.AddPermissionProvider<Permissions>();

        // Stránka hromadného nastavení v menu Vzhled → Definice obsahu
        services.AddNavigationProvider<AdminMenu>();

        // Vykreslené náhledy pro načtení iframem přes URL (místo srcdoc – kvůli CSP).
        // Singleton: úložiště musí přežít mezi požadavky (render → frame).
        services.AddMemoryCache();
        services.AddSingleton<LivePreviewFrameStore>();
    }
}