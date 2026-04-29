using System.Net;
using System.Text.Json;
using NwsReader.Models;

namespace NwsReader.Services;

public enum QueryType { Area, Zone, Point, National }

public sealed class NwsClient
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
    };

    private readonly HttpClient _http;
    private readonly ILogger<NwsClient> _log;

    public NwsClient(HttpClient http, ILogger<NwsClient> log)
    {
        _http = http;
        _log = log;
    }

    public async Task<AlertsResponse> GetActiveAlertsAsync(
        QueryType type,
        string? value,
        CancellationToken ct)
    {
        string url;
        string queryDescription;
        if (type == QueryType.National)
        {
            url = "/alerts/active";
            queryDescription = "national";
        }
        else
        {
            if (string.IsNullOrWhiteSpace(value))
                throw new ArgumentException("Value is required for non-national queries.", nameof(value));

            var paramName = type switch
            {
                QueryType.Area => "area",
                QueryType.Zone => "zone",
                QueryType.Point => "point",
                _ => throw new ArgumentOutOfRangeException(nameof(type)),
            };
            url = $"/alerts/active?{paramName}={Uri.EscapeDataString(value)}";
            queryDescription = $"{paramName}={value}";
        }
        _log.LogDebug("NWS request: {Url}", url);

        using var response = await _http.GetAsync(url, ct);

        if (!response.IsSuccessStatusCode)
        {
            var body = await response.Content.ReadAsStringAsync(ct);
            throw new NwsApiException(
                response.StatusCode,
                $"NWS API returned {(int)response.StatusCode}: {body}");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(ct);
        var fc = await JsonSerializer.DeserializeAsync<NwsFeatureCollection>(
            stream, JsonOpts, ct);

        var alerts = (fc?.Features ?? [])
            .Where(f => f.Properties is not null)
            .Select(f =>
            {
                var p = f.Properties!;
                var haystack = $"{p.Headline} {p.Description}";
                return new AlertDto(
                    Id: p.Id ?? f.Id ?? Guid.NewGuid().ToString(),
                    Event: p.Event ?? "Unknown",
                    Severity: p.Severity,
                    Urgency: p.Urgency,
                    Certainty: p.Certainty,
                    AreaDesc: p.AreaDesc,
                    Sent: p.Sent,
                    Effective: p.Effective,
                    Onset: p.Onset,
                    Expires: p.Expires,
                    Ends: p.Ends,
                    Headline: p.Headline,
                    Description: p.Description,
                    Instruction: p.Instruction,
                    SenderName: p.SenderName,
                    IsPds: ContainsCi(haystack, "PARTICULARLY DANGEROUS SITUATION"),
                    IsEmergency: ContainsCi(haystack, "TORNADO EMERGENCY")
                              || ContainsCi(haystack, "FLASH FLOOD EMERGENCY"),
                    Geometry: NormalizeGeometry(f.Geometry));
            })
            .OrderBy(a => a.IsEmergency ? 0 : a.IsPds ? 1 : 2)
            .ThenBy(a => SeverityRank(a.Severity))
            .ThenByDescending(a => a.Sent ?? DateTimeOffset.MinValue)
            .ToList();

        return new AlertsResponse(
            Alerts: alerts,
            Updated: fc?.Updated ?? DateTimeOffset.UtcNow,
            Query: queryDescription);
    }

    private static int SeverityRank(string? s) => s switch
    {
        "Extreme" => 0,
        "Severe" => 1,
        "Moderate" => 2,
        "Minor" => 3,
        _ => 4,
    };

    private static bool ContainsCi(string haystack, string needle)
        => haystack.Contains(needle, StringComparison.OrdinalIgnoreCase);

    private static JsonElement? NormalizeGeometry(JsonElement? geom)
    {
        if (geom is null) return null;
        var k = geom.Value.ValueKind;
        return k is JsonValueKind.Null or JsonValueKind.Undefined ? null : geom;
    }
}

public sealed class NwsApiException : Exception
{
    public HttpStatusCode StatusCode { get; }
    public NwsApiException(HttpStatusCode status, string message) : base(message)
        => StatusCode = status;
}
