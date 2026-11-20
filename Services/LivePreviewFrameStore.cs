using System.Collections.Concurrent;
using System.Security.Cryptography;
using Microsoft.Extensions.Caching.Memory;

namespace PV.LivePreview.Services;

/// <summary>
/// Krátkodobé úložiště vykreslených náhledů. Iframe náhledu načítá stránku z vlastní URL
/// (api/pv-live-preview/frame/{token}) místo srcdoc – dokument tak má CSP webu,
/// ne CSP administrace, kterou by srcdoc zdědil (bod 10 code review).
///
/// Náhled je vázaný na uživatele, který ho vykreslil, a po krátké době vyprší.
/// Pro každého uživatele se drží jen několik posledních náhledů – při rychlém psaní
/// vzniká nový náhled každou chvíli a starší už nikdo nenačte.
///
/// Úložiště je v paměti procesu (IMemoryCache). Při běhu na více serverech za load
/// balancerem by bylo potřeba sticky sessions nebo distribuovanou cache.
/// </summary>
public sealed class LivePreviewFrameStore(IMemoryCache memoryCache)
{
    private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(2);

    // Panel v editoru + případné samostatné okno + rezerva pro náhled, který se právě načítá
    private const int MaxFramesPerUser = 6;

    private const string CacheKeyPrefix = "PV.LivePreview.Frame:";

    // Pořadí tokenů jednotlivých uživatelů – nejstarší se z cache odstraní
    private readonly ConcurrentDictionary<string, Queue<string>> _tokensByUser = new(StringComparer.Ordinal);

    public string Store(string userId, string html)
    {
        // 128 bitů náhody – token nejde uhodnout
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

        memoryCache.Set(CacheKeyPrefix + token, new StoredFrame(userId, html), new MemoryCacheEntryOptions
        {
            AbsoluteExpirationRelativeToNow = Lifetime,
        });

        var queue = _tokensByUser.GetOrAdd(userId, _ => new Queue<string>());
        lock (queue)
        {
            queue.Enqueue(token);
            while (queue.Count > MaxFramesPerUser)
            {
                memoryCache.Remove(CacheKeyPrefix + queue.Dequeue());
            }
        }

        return token;
    }

    /// <summary>
    /// HTML náhledu, pokud existuje a patří danému uživateli; jinak null.
    /// </summary>
    public string? Get(string userId, string token)
    {
        if (string.IsNullOrEmpty(token)
            || !memoryCache.TryGetValue(CacheKeyPrefix + token, out StoredFrame? frame)
            || frame == null
            || !string.Equals(frame.UserId, userId, StringComparison.Ordinal))
        {
            return null;
        }

        return frame.Html;
    }

    private sealed record StoredFrame(string UserId, string Html);
}
