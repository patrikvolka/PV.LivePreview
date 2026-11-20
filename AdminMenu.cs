using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Localization;
using OrchardCore.Navigation;

namespace PV.LivePreview;

/// <summary>
/// Položka „Živý náhled“ v menu Vzhled → Definice obsahu, za „Typy obsahu“ a „Části obsahu“.
/// V OrchardCore 3 je Definice obsahu pod menu Design (Vzhled), ne pod Obsahem.
/// Klíče textů ("Design", "Content Definition") musí odpovídat menu modulu
/// OrchardCore.ContentTypes – OC podle nich položky sloučí a nevznikne druhá „Definice obsahu“.
/// </summary>
public sealed class AdminMenu(IStringLocalizer<AdminMenu> stringLocalizer) : AdminNavigationProvider
{
    private static readonly RouteValueDictionary _routeValues = new()
    {
        { "area", "PV.LivePreview" },
    };

    internal readonly IStringLocalizer S = stringLocalizer;

    protected override ValueTask BuildAsync(NavigationBuilder builder)
    {
        builder
            .Add(S["Design"], design => design
                .Add(S["Content Definition"], S["Content Definition"].PrefixPosition("9"), contentDefinition => contentDefinition
                    // OC: Typy obsahu = 1, Části obsahu = 2
                    .Add(S["Live Preview"], S["Live Preview"].PrefixPosition("3"), livePreview => livePreview
                        .Action("Index", "Admin", _routeValues)
                        .Permission(Permissions.EditContentTypes)
                        .LocalNav()
                    )
                )
            );

        return ValueTask.CompletedTask;
    }
}
