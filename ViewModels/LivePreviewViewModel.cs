using PV.LivePreview.Models;

namespace PV.LivePreview.ViewModels;

/// <summary>
/// ViewModel pro předání dat do Razor šablony našeho injektovaného UI.
/// </summary>
public class LivePreviewViewModel
{
    public string Position { get; set; } = string.Empty;
    public string ContentItemId { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;

    /// <summary>Nastavení typu obsahu (zařízení, zpoždění, skrytí při otevření).</summary>
    public LivePreviewSettings Settings { get; set; } = new();
}
