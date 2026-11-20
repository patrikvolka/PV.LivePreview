using PV.LivePreview.Models;

namespace PV.LivePreview.ViewModels;

/// <summary>
/// Stránka hromadného nastavení: seznam typů obsahu s aktuální pozicí náhledu.
/// </summary>
public class LivePreviewContentTypesViewModel
{
    public IList<LivePreviewContentTypeEntry> ContentTypes { get; set; } = [];
}

public class LivePreviewContentTypeEntry
{
    /// <summary>Technický název typu (ContentType).</summary>
    public string Name { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    /// <summary>Stereotyp typu (Widget, MenuItem…), u běžného obsahu prázdný.</summary>
    public string? Stereotype { get; set; }

    public LivePreviewPosition Position { get; set; }
}

/// <summary>
/// Odeslaný formulář hromadné akce.
/// </summary>
public class LivePreviewBulkUpdateModel
{
    public string[] SelectedTypes { get; set; } = [];

    public LivePreviewPosition Position { get; set; } = LivePreviewPosition.Right;
}
