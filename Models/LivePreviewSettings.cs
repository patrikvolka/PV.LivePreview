namespace PV.LivePreview.Models;

/// <summary>
/// Definuje dostupné pozice pro integrovaný živý náhled v UI.
/// </summary>
public enum LivePreviewPosition
{
    None = 0,
    Left = 1,
    Right = 2,
    Bottom = 3
}

/// <summary>
/// Model nastavení ukládaný do definice ContentType.
/// Výchozí hodnoty nových vlastností odpovídají chování před jejich zavedením,
/// takže dříve uložené typy fungují beze změny.
/// </summary>
public class LivePreviewSettings
{
    /// <summary>Hodnota UpdateDelay, pokud není nastavená.</summary>
    public const int DefaultUpdateDelay = 600;
    public const int MinUpdateDelay = 100;
    public const int MaxUpdateDelay = 5000;

    /// <summary>
    /// Vybraná pozice panelu s náhledem. Výchozí je vypnuto (None).
    /// </summary>
    public LivePreviewPosition Position { get; set; } = LivePreviewPosition.None;

    /// <summary>
    /// Výchozí zařízení – id vestavěného zařízení (LivePreviewDevices.BuiltIn) nebo
    /// "preset:{název}" vlastního zařízení. Použije se, když si uživatel pro typ obsahu
    /// ještě nic nezvolil. Null = Laptop.
    /// </summary>
    public string? DefaultDevice { get; set; }

    /// <summary>
    /// Zobrazená vestavěná zařízení. Null = všechna (i ta, která přibudou v dalších verzích).
    /// </summary>
    public string[]? Devices { get; set; }

    /// <summary>
    /// Vlastní zařízení typu obsahu (např. konkrétní telefon zákazníka).
    /// </summary>
    public List<LivePreviewCustomDevice> CustomDevices { get; set; } = [];

    /// <summary>
    /// Zpoždění aktualizace po změně formuláře v ms.
    /// </summary>
    public int UpdateDelay { get; set; } = DefaultUpdateDelay;

    /// <summary>
    /// Při otevření editace je náhled skrytý – pro typy s náročným vykreslením.
    /// </summary>
    public bool StartHidden { get; set; }
}

/// <summary>
/// Vlastní zařízení s pevným rozměrem viewportu.
/// </summary>
public class LivePreviewCustomDevice
{
    public const int MaxNameLength = 40;
    public const int MinSize = 200;
    public const int MaxSize = 3840;
    public const int MaxCount = 10;

    public string Name { get; set; } = string.Empty;
    public int Width { get; set; }
    public int Height { get; set; }
}

/// <summary>
/// Vestavěná zařízení – id musí odpovídat atributům data-device v pv-live-preview.js.
/// </summary>
public static class LivePreviewDevices
{
    public const string Fluid = "fluid";
    public const string Mobile = "mobile";
    public const string Tablet = "tablet";
    public const string Laptop = "laptop";
    public const string Desktop = "desktop";
    public const string Custom = "custom";

    /// <summary>Prefix id vlastního zařízení: "preset:{název}".</summary>
    public const string PresetPrefix = "preset:";

    public static readonly string[] BuiltIn = [Fluid, Mobile, Tablet, Laptop, Desktop, Custom];
}
