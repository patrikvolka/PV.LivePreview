using PV.LivePreview.Models;

namespace PV.LivePreview.ViewModels;

/// <summary>
/// Formulář nastavení živého náhledu v editoru typu obsahu.
/// Liší se od uloženého LivePreviewSettings: vlastní zařízení se zadávají jako text
/// (jedno na řádek „Název; šířka x výška“), aby editor nepotřeboval vlastní JavaScript.
/// </summary>
public class LivePreviewSettingsViewModel
{
    public LivePreviewPosition Position { get; set; }

    public string? DefaultDevice { get; set; }

    /// <summary>Zaškrtnutá vestavěná zařízení.</summary>
    public string[] Devices { get; set; } = [];

    public string? CustomDevicesText { get; set; }

    public int UpdateDelay { get; set; } = LivePreviewSettings.DefaultUpdateDelay;

    public bool StartHidden { get; set; }

    /// <summary>Uložená vlastní zařízení – nabízejí se jako výchozí zařízení (jen pro zobrazení).</summary>
    public IList<LivePreviewCustomDevice> SavedCustomDevices { get; set; } = [];
}
