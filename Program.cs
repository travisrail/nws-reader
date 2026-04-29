using Microsoft.AspNetCore.Mvc;
using NwsReader.Services;

var builder = WebApplication.CreateBuilder(args);

var nwsBase = builder.Configuration["Nws:BaseAddress"]
    ?? "https://api.weather.gov";
var userAgent = builder.Configuration["Nws:UserAgent"]
    ?? throw new InvalidOperationException(
        "Nws:UserAgent is required — NWS rejects requests without a User-Agent.");
var timeout = TimeSpan.FromSeconds(
    builder.Configuration.GetValue("Nws:TimeoutSeconds", 15));

builder.Services.AddHttpClient<NwsClient>(c =>
{
    c.BaseAddress = new Uri(nwsBase);
    c.Timeout = timeout;
    c.DefaultRequestHeaders.UserAgent.ParseAdd(userAgent);
    c.DefaultRequestHeaders.Accept.ParseAdd("application/geo+json");
});

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

app.MapGet("/api/alerts", async (
    [FromQuery] string? type,
    [FromQuery] string? value,
    NwsClient nws,
    CancellationToken ct) =>
{
    if (!Enum.TryParse<QueryType>(type, ignoreCase: true, out var qt))
        return Results.BadRequest(new
        {
            error = "Invalid 'type'. Expected 'area', 'zone', 'point', or 'national'.",
        });

    if (qt != QueryType.National && string.IsNullOrWhiteSpace(value))
        return Results.BadRequest(new { error = "Missing 'value' query parameter." });

    try
    {
        var result = await nws.GetActiveAlertsAsync(qt, value, ct);
        return Results.Ok(result);
    }
    catch (NwsApiException ex)
    {
        return Results.Problem(
            detail: ex.Message,
            statusCode: (int)ex.StatusCode,
            title: "NWS API error");
    }
    catch (TaskCanceledException) when (!ct.IsCancellationRequested)
    {
        return Results.Problem(
            detail: "Request to NWS API timed out.",
            statusCode: StatusCodes.Status504GatewayTimeout,
            title: "Upstream timeout");
    }
});

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.Run();
