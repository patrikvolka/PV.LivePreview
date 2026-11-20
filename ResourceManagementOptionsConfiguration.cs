using Microsoft.Extensions.Options;
using OrchardCore.ResourceManagement;

namespace PV.LivePreview;

/// <summary>
/// Registrace statických prostředků modulu (wwwroot) pro Resource Manager.
/// Soubory z wwwroot modulu jsou dostupné pod ~/{ModuleId}/...
///
/// Používají se minifikované soubory (*.min.css, *.min.js), které vznikají při buildu
/// z bundleconfig.json (balíček BuildBundlerMinifier2022). Druhá URL v SetUrl je „debug“
/// varianta – plný soubor, který OC použije v režimu ladění prostředků
/// (vývojové prostředí, případně Nastavení → Obecné → Resource debug mode).
/// Upravuje se vždy plný soubor, minifikovaný se přegeneruje při dalším buildu.
/// </summary>
public sealed class ResourceManagementOptionsConfiguration : IConfigureOptions<ResourceManagementOptions>
{
    public const string ResourceName = "PV.LivePreview";
    public const string AdminResourceName = "PV.LivePreview.Admin";
    public const string WindowResourceName = "PV.LivePreview.Window";

    private static readonly ResourceManifest _manifest;

    static ResourceManagementOptionsConfiguration()
    {
        _manifest = new ResourceManifest();

        _manifest
            .DefineStyle(ResourceName)
            .SetUrl("~/PV.LivePreview/css/pv-live-preview.min.css", "~/PV.LivePreview/css/pv-live-preview.css")
            .SetVersion("3.0.1");

        _manifest
            .DefineScript(ResourceName)
            .SetUrl("~/PV.LivePreview/js/pv-live-preview.min.js", "~/PV.LivePreview/js/pv-live-preview.js")
            .SetVersion("3.0.1");

        // Samostatné okno náhledu (api/pv-live-preview/window)
        _manifest
            .DefineScript(WindowResourceName)
            .SetUrl("~/PV.LivePreview/js/pv-live-preview-window.min.js", "~/PV.LivePreview/js/pv-live-preview-window.js")
            .SetVersion("3.0.1");

        // Stránka hromadného nastavení (Vzhled → Definice obsahu → Živý náhled)
        _manifest
            .DefineScript(AdminResourceName)
            .SetUrl("~/PV.LivePreview/js/pv-live-preview-admin.min.js", "~/PV.LivePreview/js/pv-live-preview-admin.js")
            .SetVersion("3.0.1");
    }

    public void Configure(ResourceManagementOptions options)
    {
        options.ResourceManifests.Add(_manifest);
    }
}
