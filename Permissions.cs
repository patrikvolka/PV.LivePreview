using OrchardCore;
using OrchardCore.Security.Permissions;

namespace PV.LivePreview;

/// <summary>
/// Oprávnění modulu. Náhled jde povolit jen některým rolím, nezávisle na EditContent –
/// hodí se, pokud je vykreslení náročné. Kromě tohoto oprávnění musí uživatel
/// položku smět upravovat (kontrola EditContent v LivePreviewController zůstává).
/// </summary>
public sealed class Permissions : IPermissionProvider
{
    public static readonly Permission UseLivePreview = new("UseLivePreview", "Use Live Preview when editing content");

    /// <summary>
    /// Oprávnění modulu OrchardCore.ContentTypes („Edit Content Types“). Patří tomu modulu –
    /// není v GetPermissionsAsync. OC autorizuje podle názvu, stačí tedy stejný Name.
    /// Hromadné nastavení mění definice typů, proto vyžaduje stejné oprávnění jako editor typu.
    /// </summary>
    public static readonly Permission EditContentTypes = new("EditContentTypes", "Edit Content Types", isSecurityCritical: true);

    private readonly IEnumerable<Permission> _allPermissions =
    [
        UseLivePreview,
    ];

    public Task<IEnumerable<Permission>> GetPermissionsAsync()
        => Task.FromResult(_allPermissions);

    // Výchozí přiřazení odpovídá rolím, které v OC standardně upravují obsah –
    // pro ně se chování proti předchozí verzi nemění.
    public IEnumerable<PermissionStereotype> GetDefaultStereotypes() =>
    [
        new PermissionStereotype
        {
            Name = OrchardCoreConstants.Roles.Administrator,
            Permissions = _allPermissions,
        },
        new PermissionStereotype
        {
            Name = OrchardCoreConstants.Roles.Editor,
            Permissions = _allPermissions,
        },
        new PermissionStereotype
        {
            Name = OrchardCoreConstants.Roles.Author,
            Permissions = _allPermissions,
        },
        new PermissionStereotype
        {
            Name = OrchardCoreConstants.Roles.Contributor,
            Permissions = _allPermissions,
        },
    ];
}
