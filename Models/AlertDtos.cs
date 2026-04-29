using System.Text.Json;
using System.Text.Json.Serialization;

namespace NwsReader.Models;

/// <summary>Trimmed-down alert shape we send to the browser.</summary>
public sealed record AlertDto(
    string Id,
    string Event,
    string? Severity,
    string? Urgency,
    string? Certainty,
    string? AreaDesc,
    DateTimeOffset? Sent,
    DateTimeOffset? Effective,
    DateTimeOffset? Onset,
    DateTimeOffset? Expires,
    DateTimeOffset? Ends,
    string? Headline,
    string? Description,
    string? Instruction,
    string? SenderName,
    bool IsPds,
    bool IsEmergency,
    JsonElement? Geometry);

public sealed record AlertsResponse(
    IReadOnlyList<AlertDto> Alerts,
    DateTimeOffset Updated,
    string Query);

// --- internal NWS GeoJSON shapes (only fields we need) ---

internal sealed record NwsFeatureCollection(
    [property: JsonPropertyName("features")] NwsFeature[]? Features,
    [property: JsonPropertyName("updated")] DateTimeOffset? Updated);

internal sealed record NwsFeature(
    [property: JsonPropertyName("id")] string? Id,
    [property: JsonPropertyName("geometry")] JsonElement? Geometry,
    [property: JsonPropertyName("properties")] NwsAlertProperties? Properties);

internal sealed record NwsAlertProperties(
    [property: JsonPropertyName("id")] string? Id,
    [property: JsonPropertyName("event")] string? Event,
    [property: JsonPropertyName("severity")] string? Severity,
    [property: JsonPropertyName("urgency")] string? Urgency,
    [property: JsonPropertyName("certainty")] string? Certainty,
    [property: JsonPropertyName("areaDesc")] string? AreaDesc,
    [property: JsonPropertyName("sent")] DateTimeOffset? Sent,
    [property: JsonPropertyName("effective")] DateTimeOffset? Effective,
    [property: JsonPropertyName("onset")] DateTimeOffset? Onset,
    [property: JsonPropertyName("expires")] DateTimeOffset? Expires,
    [property: JsonPropertyName("ends")] DateTimeOffset? Ends,
    [property: JsonPropertyName("headline")] string? Headline,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("instruction")] string? Instruction,
    [property: JsonPropertyName("senderName")] string? SenderName);
