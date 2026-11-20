using System.Text.RegularExpressions;
using Microsoft.Extensions.Localization;
using OrchardCore.ContentManagement.Metadata.Models;
using OrchardCore.ContentTypes.Editors;
using OrchardCore.DisplayManagement.Handlers;
using OrchardCore.DisplayManagement.Views;
using PV.LivePreview.Models;
using PV.LivePreview.ViewModels;

namespace PV.LivePreview.Drivers;

/// <summary>
/// Zajišťuje vykreslení a uložení nastavení LivePreview v editoru ContentType.
/// </summary>
public partial class LivePreviewSettingsDriver : ContentTypeDefinitionDisplayDriver
{
    private readonly IStringLocalizer S;

    public LivePreviewSettingsDriver(IStringLocalizer<LivePreviewSettingsDriver> stringLocalizer)
    {
        S = stringLocalizer;

        // Pole formuláře se odesílají jako "LivePreviewSettings.Position" atd. místo holých názvů,
        // aby nekolidovala s jinými drivery editoru typu obsahu bez prefixu.
        // Uložená nastavení to neovlivní – ukládají se do JSON definice typu podle názvu třídy.
        Prefix = nameof(LivePreviewSettings);
    }

    /// <summary>
    /// Vykreslí editační formulář nastavení.
    /// </summary>
    public override IDisplayResult Edit(ContentTypeDefinition contentTypeDefinition, BuildEditorContext context)
    {
        return Initialize<LivePreviewSettingsViewModel>("LivePreviewSettings_Edit", model =>
        {
            var settings = contentTypeDefinition.GetSettings<LivePreviewSettings>();

            model.Position = settings.Position;
            model.DefaultDevice = settings.DefaultDevice;
            // Null = všechna vestavěná zařízení
            model.Devices = settings.Devices ?? LivePreviewDevices.BuiltIn;
            model.CustomDevicesText = string.Join("\n",
                settings.CustomDevices.Select(d => $"{d.Name}; {d.Width}x{d.Height}"));
            model.UpdateDelay = settings.UpdateDelay;
            model.StartHidden = settings.StartHidden;
            model.SavedCustomDevices = settings.CustomDevices;
        }).Location("Content:5");
    }

    /// <summary>
    /// Asynchronně aktualizuje nastavení na základě odeslaných dat.
    /// </summary>
    public override async Task<IDisplayResult> UpdateAsync(ContentTypeDefinition contentTypeDefinition, UpdateTypeEditorContext context)
    {
        var model = new LivePreviewSettingsViewModel();

        if (!await context.Updater.TryUpdateModelAsync(model, Prefix))
        {
            return Edit(contentTypeDefinition, context);
        }

        var modelState = context.Updater.ModelState;
        var isValid = true;

        if (!Enum.IsDefined(model.Position))
        {
            modelState.AddModelError(Prefix + "." + nameof(model.Position), S["The live preview position is not valid."]);
            isValid = false;
        }

        if (model.UpdateDelay < LivePreviewSettings.MinUpdateDelay || model.UpdateDelay > LivePreviewSettings.MaxUpdateDelay)
        {
            modelState.AddModelError(Prefix + "." + nameof(model.UpdateDelay),
                S["The update delay must be between {0} and {1} ms.", LivePreviewSettings.MinUpdateDelay, LivePreviewSettings.MaxUpdateDelay]);
            isValid = false;
        }

        var customDevices = ParseCustomDevices(model.CustomDevicesText, out var customDeviceErrors);
        foreach (var error in customDeviceErrors)
        {
            modelState.AddModelError(Prefix + "." + nameof(model.CustomDevicesText), error);
            isValid = false;
        }

        // Jen známá vestavěná zařízení (hodnoty přicházejí z formuláře)
        var devices = (model.Devices ?? [])
            .Where(d => LivePreviewDevices.BuiltIn.Contains(d))
            .Distinct()
            .ToArray();

        if (devices.Length == 0 && customDevices.Count == 0)
        {
            modelState.AddModelError(Prefix + "." + nameof(model.Devices), S["Select at least one device or define a custom device."]);
            isValid = false;
        }

        if (!isValid)
        {
            // Formulář s odeslanými hodnotami – správce nepřijde o to, co právě napsal
            model.Devices = devices;
            model.SavedCustomDevices = contentTypeDefinition.GetSettings<LivePreviewSettings>().CustomDevices;
            return Initialize<LivePreviewSettingsViewModel>("LivePreviewSettings_Edit", m =>
            {
                m.Position = model.Position;
                m.DefaultDevice = model.DefaultDevice;
                m.Devices = model.Devices;
                m.CustomDevicesText = model.CustomDevicesText;
                m.UpdateDelay = model.UpdateDelay;
                m.StartHidden = model.StartHidden;
                m.SavedCustomDevices = model.SavedCustomDevices;
            }).Location("Content:5");
        }

        context.Builder.WithSettings(new LivePreviewSettings
        {
            Position = model.Position,
            DefaultDevice = string.IsNullOrWhiteSpace(model.DefaultDevice) ? null : model.DefaultDevice,
            // Všechna zaškrtnutá = null, aby se nová vestavěná zařízení z dalších verzí zobrazila sama
            Devices = devices.Length == LivePreviewDevices.BuiltIn.Length ? null : devices,
            CustomDevices = customDevices,
            UpdateDelay = model.UpdateDelay,
            StartHidden = model.StartHidden,
        });

        return Edit(contentTypeDefinition, context);
    }

    // „Název; 412x915“ – oddělovač rozměrů x, X, × nebo *
    [GeneratedRegex(@"^(?<w>\d{1,5})\s*[xX×*]\s*(?<h>\d{1,5})$")]
    private static partial Regex SizeRegex();

    private List<LivePreviewCustomDevice> ParseCustomDevices(string? text, out List<string> errors)
    {
        errors = [];
        var devices = new List<LivePreviewCustomDevice>();
        if (string.IsNullOrWhiteSpace(text))
        {
            return devices;
        }

        var lines = text.Split('\n', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i < lines.Length; i++)
        {
            var lineNumber = i + 1;
            var line = lines[i];

            // Poslední středník odděluje rozměr – název tak smí středník obsahovat
            var separator = line.LastIndexOf(';');
            var name = separator > 0 ? line[..separator].Trim() : string.Empty;
            var match = separator > 0 ? SizeRegex().Match(line[(separator + 1)..].Trim()) : Match.Empty;

            if (name.Length == 0 || !match.Success)
            {
                errors.Add(S["Custom devices, line {0}: use the format \"Name; width x height\", for example \"Galaxy S20; 412x915\".", lineNumber]);
                continue;
            }

            if (name.Length > LivePreviewCustomDevice.MaxNameLength)
            {
                errors.Add(S["Custom devices, line {0}: the name can have at most {1} characters.", lineNumber, LivePreviewCustomDevice.MaxNameLength]);
                continue;
            }

            var width = int.Parse(match.Groups["w"].Value);
            var height = int.Parse(match.Groups["h"].Value);
            if (width < LivePreviewCustomDevice.MinSize || width > LivePreviewCustomDevice.MaxSize
                || height < LivePreviewCustomDevice.MinSize || height > LivePreviewCustomDevice.MaxSize)
            {
                errors.Add(S["Custom devices, line {0}: the width and height must be between {1} and {2} px.", lineNumber, LivePreviewCustomDevice.MinSize, LivePreviewCustomDevice.MaxSize]);
                continue;
            }

            // Název je identifikátor zařízení (pamatuje si ho prohlížeč uživatele)
            if (devices.Any(d => string.Equals(d.Name, name, StringComparison.OrdinalIgnoreCase)))
            {
                errors.Add(S["Custom devices, line {0}: the name \"{1}\" is used more than once.", lineNumber, name]);
                continue;
            }

            devices.Add(new LivePreviewCustomDevice { Name = name, Width = width, Height = height });
        }

        if (devices.Count > LivePreviewCustomDevice.MaxCount)
        {
            errors.Add(S["You can define at most {0} custom devices.", LivePreviewCustomDevice.MaxCount]);
        }

        return devices;
    }
}
