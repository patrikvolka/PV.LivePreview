using OrchardCore.Modules.Manifest;

[assembly: Module(
    Name = "PV Live Preview",
    Id = "PV.LivePreview",
    Author = "Patrik Volka",
    Website = "https://patrik-volka.cz",
    Version = "3.0.1",
    Description = "Integruje responzivní živý náhled přímo do editační stránky obsahu.",
    Category = "Content Management",
    Dependencies =
    [
        // Editace obsahu, ve které se náhled zobrazuje, a oprávnění EditContent
        "OrchardCore.Contents",
        // Editor typu obsahu, kde se nastavuje pozice náhledu
        "OrchardCore.ContentTypes"
    ]
)]
